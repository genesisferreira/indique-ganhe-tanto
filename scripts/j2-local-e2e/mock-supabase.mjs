// 3.1F-J2 — Supabase LOCAL simulado (127.0.0.1) sobre o PostgreSQL de lab.
// Somente para E2E/screenshots locais. Nunca aponta para produção.
// - /auth/v1/user: identidade a partir de um JWT de lab (sem assinatura válida; só local).
// - /rest/v1/<tabela>: subconjunto GET do PostgREST (colunas simples + filtros básicos).
// - /rest/v1/rpc/<fn>: chamada nomeada.
// TODA consulta roda em transação READ ONLY + ROLLBACK, com o papel do token
// (anon | authenticated+sub | service_role). Escritas HTTP são recusadas e contadas.
import { createServer } from "node:http"

const IDENT = /^[a-z_][a-z0-9_]*$/

export function labJwt(sub, extra = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86400, ...extra })}.bGFiLW9ubHktbm90LXNpZ25lZA`
}

export function labSessionCookie(sub, email) {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: labJwt(sub),
    token_type: "bearer",
    expires_in: 86400,
    expires_at: now + 86400,
    refresh_token: "lab-refresh-" + sub.slice(0, 8),
    user: { id: sub, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  }
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url")
}

function decodeSub(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
    return typeof p.sub === "string" && /^[0-9a-f-]{36}$/i.test(p.sub) ? p.sub : null
  } catch { return null }
}

export async function startMockSupabase({ port, client, anonKey, serviceKey, allowOrigin, users }) {
  const stats = { requests: 0, writeAttempts: [], unsupported: [], rpc: {}, errors: 0, restLog: [] }
  // 3.1F-J2C (lab): injeção de falha de infraestrutura no Auth/tabelas, com detalhe "secreto" que NÃO pode vazar.
  const faults = { auth: false, tables: new Set() }
  // 3.1F-K1S (lab): latência artificial (ms) por rota — padrão 0 (comportamento inalterado). Mutável em tempo de execução
  // para reproduzir contenção do lock de auth (auth-js navigator lock, acquire timeout 5 s) com RTT realista.
  const latency = { authUserMs: 0, restMs: 0 }
  const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : null)
  let chain = Promise.resolve()
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p }

  const runAs = (auth, sql, params) => serial(async () => {
    await client.query("begin transaction read only")
    try {
      await client.query(`set local role ${auth.role}`)
      if (auth.sub) await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [auth.sub])
      const r = await client.query(sql, params)
      return r.rows
    } finally { await client.query("rollback").catch(() => {}) }
  })

  const authOf = (req) => {
    const h = String(req.headers.authorization || "")
    const token = h.startsWith("Bearer ") ? h.slice(7) : String(req.headers.apikey || "")
    if (token && token === serviceKey) return { role: "service_role", sub: null }
    if (!token || token === anonKey) return { role: "anon", sub: null }
    const sub = decodeSub(token)
    return sub ? { role: "authenticated", sub } : { role: "anon", sub: null }
  }

  const send = (res, status, body, headers = {}) => {
    const h = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Expose-Headers": "content-range",
      ...headers,
    }
    if (body === undefined) { res.writeHead(status, h); return res.end() }
    res.writeHead(status, { "Content-Type": "application/json", ...h })
    res.end(JSON.stringify(body))
  }

  const pgErr = (res, e) => {
    stats.errors++
    const status = e.code === "42501" ? 403 : e.code === "P0001" || e.code === "22023" || e.code === "22P02" ? 400 : 400
    send(res, status, { code: e.code ?? "PGRST000", message: e.message, details: null, hint: null })
  }

  const parseFilter = (col, raw, params) => {
    const qcol = `"${col}"`
    const dot = raw.indexOf(".")
    const op = raw.slice(0, dot), val = raw.slice(dot + 1)
    const add = (v) => { params.push(v); return `$${params.length}` }
    switch (op) {
      case "eq": return `${qcol}::text = ${add(val)}`
      case "neq": return `${qcol}::text <> ${add(val)}`
      case "gt": return `${qcol} > ${add(val)}`
      case "gte": return `${qcol} >= ${add(val)}`
      case "lt": return `${qcol} < ${add(val)}`
      case "lte": return `${qcol} <= ${add(val)}`
      case "is": return val === "null" ? `${qcol} is null` : val === "true" ? `${qcol} is true` : val === "false" ? `${qcol} is false` : null
      case "in": {
        const items = val.replace(/^\(|\)$/g, "").split(",").filter(Boolean).map((s) => s.replace(/^"|"$/g, ""))
        if (items.length === 0) return "false"
        return `${qcol}::text = any(${add(items)}::text[])`
      }
      case "like": return `${qcol}::text like ${add(val.replace(/\*/g, "%"))}`
      case "ilike": return `${qcol}::text ilike ${add(val.replace(/\*/g, "%"))}`
      default: return null
    }
  }

  const server = createServer(async (req, res) => {
    stats.requests++
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (req.method === "OPTIONS") {
      // Lab-only: ecoa os cabeçalhos solicitados (somente para a origem local permitida).
      const reqH = String(req.headers["access-control-request-headers"] || "").replace(/[^a-zA-Z0-9,\- ]/g, "")
      return send(res, 204, undefined, reqH ? { "Access-Control-Allow-Headers": reqH } : {})
    }
    const auth = authOf(req)
    try {
      if (url.pathname === "/auth/v1/user") {
        await pause(latency.authUserMs)
        if (faults.auth) return send(res, 503, { code: 503, msg: "SECRET lab auth detail" })
        if (auth.role !== "authenticated") return send(res, 401, { code: 401, msg: "invalid JWT" })
        const u = users[auth.sub]
        if (!u) return send(res, 401, { code: 401, msg: "user not found" })
        return send(res, 200, { id: auth.sub, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" })
      }
      if (url.pathname.startsWith("/auth/v1/logout")) return send(res, 204)
      if (url.pathname.startsWith("/auth/v1/")) return send(res, 400, { code: 400, msg: "not supported in lab" })
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.slice("/rest/v1/rpc/".length)
        if (!IDENT.test(fn)) return send(res, 404, { code: "PGRST202", message: "not found" })
        let body = ""
        for await (const chunk of req) body += chunk
        const args = body ? JSON.parse(body) : {}
        const names = Object.keys(args).filter((k) => IDENT.test(k))
        const params = names.map((k) => (args[k] === null || args[k] === undefined ? null : String(args[k])))
        stats.rpc[fn] = (stats.rpc[fn] || 0) + 1
        const sql = `select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`
        try {
          const rows = await runAs(auth, sql, params)
          return send(res, 200, rows[0]?.r ?? null)
        } catch (e) { return pgErr(res, e) }
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        // 3.1F-K1S: registro (método/caminho/query, sem corpo) para provar consultas feitas pelo servidor Next.
        if (stats.restLog.length < 20000) stats.restLog.push({ method: req.method, path: url.pathname, search: url.search })
        await pause(latency.restMs)
        const table = url.pathname.slice("/rest/v1/".length)
        if (req.method !== "GET" && req.method !== "HEAD") {
          stats.writeAttempts.push(`${req.method} ${table}`)
          return send(res, 405, { code: "LAB_READ_ONLY", message: "lab mock is read-only" })
        }
        if (!IDENT.test(table)) return send(res, 404, { code: "PGRST205", message: "not found" })
        if (faults.tables.has(table)) return send(res, 500, { code: "XX000", message: "SECRET lab db detail", details: "stack", hint: null })
        const sel = url.searchParams.get("select") || "*"
        if (/[()!:]/.test(sel)) { stats.unsupported.push(`select ${table}`); return send(res, 200, req.headers.accept?.includes("pgrst.object") ? null : [], { "Content-Range": "0-0/0" }) }
        const cols = sel === "*" ? "*" : sel.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (IDENT.test(s) ? `"${s}"` : null))
        if (cols !== "*" && cols.includes(null)) { stats.unsupported.push(`cols ${table}`); return send(res, 200, []) }
        const params = []
        const where = []
        let order = "", limit = "", offset = ""
        for (const [k, v] of url.searchParams.entries()) {
          if (k === "select") continue
          if (k === "order") {
            const parts = v.split(",").map((p) => { const [c, dir, nulls] = p.split("."); return IDENT.test(c) ? `"${c}" ${dir === "desc" ? "desc" : "asc"}${nulls === "nullslast" ? " nulls last" : nulls === "nullsfirst" ? " nulls first" : ""}` : null })
            if (parts.includes(null)) { stats.unsupported.push(`order ${table}`); return send(res, 200, []) }
            order = ` order by ${parts.join(", ")}`; continue
          }
          if (k === "limit") { limit = ` limit ${Math.min(1000, Number(v) || 0)}`; continue }
          if (k === "offset") { offset = ` offset ${Math.max(0, Number(v) || 0)}`; continue }
          if (!IDENT.test(k)) { stats.unsupported.push(`filter ${table}.${k}`); return send(res, 200, []) }
          const f = parseFilter(k, v, params)
          if (!f) { stats.unsupported.push(`op ${table}.${k}`); return send(res, 200, []) }
          where.push(f)
        }
        const whereSql = where.length ? ` where ${where.join(" and ")}` : ""
        const prefer = String(req.headers.prefer || "")
        const range = req.headers.range ? String(req.headers.range).split("-") : null
        if (range && !limit) { const a = Number(range[0]) || 0, b = Number(range[1]); offset = ` offset ${a}`; if (Number.isFinite(b)) limit = ` limit ${b - a + 1}` }
        try {
          let total = null
          if (/count=(exact|planned|estimated)/.test(prefer)) total = Number((await runAs(auth, `select count(*)::int n from public."${table}"${whereSql}`, params))[0].n)
          if (req.method === "HEAD") return send(res, 200, undefined, { "Content-Range": `*/${total ?? 0}` })
          const rows = await runAs(auth, `select ${cols === "*" ? "*" : cols.join(", ")} from public."${table}"${whereSql}${order}${limit}${offset}`, params)
          const cr = { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${total ?? "*"}` }
          if (String(req.headers.accept || "").includes("vnd.pgrst.object")) {
            if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null })
            return send(res, 200, rows[0], cr)
          }
          return send(res, 200, rows, cr)
        } catch (e) { return pgErr(res, e) }
      }
      return send(res, 404, { message: "not found" })
    } catch (e) {
      stats.errors++
      return send(res, 500, { message: "lab mock error" })
    }
  })
  await new Promise((r) => server.listen(port, "127.0.0.1", r))
  return { stats, faults, latency, close: () => new Promise((r) => server.close(r)) }
}
