// Driver mínimo do Chrome DevTools Protocol (Edge/Chrome headless), somente localhost.
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launchBrowser(executable, port = 9333) {
  const profile = mkdtempSync(join(tmpdir(), "igt-j2-cdp-"))
  const proc = spawn(executable, [
    "--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-sync",
    "--disable-background-networking", "--disable-component-update", "--no-sandbox",
    "--disable-features=EnablePortBoundCookies,EnableSchemeBoundCookies", "about:blank",
  ], { stdio: "ignore" })
  let ver = null
  for (let i = 0; i < 60 && !ver; i++) {
    await sleep(250)
    ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null)
  }
  if (!ver) { proc.kill(); throw new Error("browser did not start") }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString())
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result) }
    else if (msg.method) for (const l of listeners) l(msg)
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  const waitEvent = (name, timeout = 20000) => new Promise((res) => {
    const t = setTimeout(() => { res(null) }, timeout)
    const l = (m) => { if (m.method === name) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); res(m.params) } }
    listeners.push(l)
  })
  const diag = []
  const reqUrl = new Map()
  listeners.push((m) => {
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) diag.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200))
    else if (m.method === "Runtime.exceptionThrown") diag.push("exception: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 200))
    else if (m.method === "Network.requestWillBeSent") reqUrl.set(m.params.requestId, m.params.request.method + " " + m.params.request.url.slice(0, 160))
    else if (m.method === "Network.responseReceived" && (m.params.response.status >= 400 || /:54329\//.test(m.params.response.url))) diag.push(`net ${m.params.response.status} ${reqUrl.get(m.params.requestId) || m.params.response.url.slice(0, 160)}`)
    else if (m.method === "Network.loadingFailed") diag.push(`netfail ${m.params.errorText} ${reqUrl.get(m.params.requestId) || ""}`)
  })
  await send("Page.enable")
  await send("Network.enable")
  await send("Runtime.enable")
  return {
    version: ver.Browser,
    send,
    takeDiag() { return diag.splice(0, diag.length) },
    async setCookie(name, value, url) {
      await send("Network.clearBrowserCookies")
      if (name) {
        const u = new URL(url)
        await send("Network.setCookie", { name, value, url, path: "/", sameSite: "Lax", sourceScheme: "NonSecure", sourcePort: Number(u.port || 80) })
      }
    },
    async open(url, width, height, settleMs = 2500) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 })
      const loaded = waitEvent("Page.loadEventFired")
      await send("Page.navigate", { url })
      await loaded
      await sleep(settleMs)
      const r = await send("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true })
      return r.result.value
    },
    async evaluate(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    },
    async pressTab() {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    },
    async screenshot(fullPage = true) {
      let clip
      if (fullPage) {
        const m = await send("Page.getLayoutMetrics")
        const w = Math.ceil(m.cssLayoutViewport.clientWidth), h = Math.min(6000, Math.ceil(m.cssContentSize.height))
        clip = { x: 0, y: 0, width: w, height: h, scale: 1 }
      }
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) })
      return Buffer.from(r.data, "base64")
    },
    async close() { try { ws.close() } catch {} proc.kill(); await sleep(500) },
  }
}

/** Auditoria de layout/acessibilidade executada na página (sem dependências). */
export const AUDIT_JS = `(() => {
  const parse = (c) => {
    if (!c) return null
    let m = c.match(/^rgba?\\(([^)]+)\\)/)
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
    m = c.match(/^color\\(srgb ([^)]+)\\)/)
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: p[0]*255, g: p[1]*255, b: p[2]*255, a: p.length > 3 ? p[3] : 1 } }
    const toSrgb = (L, a, b, alpha) => {
      const l_ = L + 0.3963377774*a + 0.2158037573*b, m_ = L - 0.1055613458*a - 0.0638541728*b, s_ = L - 0.0894841775*a - 1.2914855480*b
      const l = l_**3, mm = m_**3, s = s_**3
      let r = 4.0767416621*l - 3.3077115913*mm + 0.2309699292*s, g = -1.2684380046*l + 2.6097574011*mm - 0.3413193965*s, bb = -0.0041960863*l - 0.7034186147*mm + 1.7076147010*s
      const f = (x) => { x = Math.max(0, Math.min(1, x)); return 255 * (x <= 0.0031308 ? 12.92*x : 1.055*Math.pow(x, 1/2.4) - 0.055) }
      return { r: f(r), g: f(g), b: f(bb), a: alpha }
    }
    m = c.match(/^oklch\\(([^)]+)\\)/)
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean); const L = p[0].endsWith('%') ? parseFloat(p[0])/100 : parseFloat(p[0]); const C = parseFloat(p[1]) || 0; const H = (parseFloat(p[2]) || 0) * Math.PI/180; const al = p[3] ? (p[3].endsWith('%') ? parseFloat(p[3])/100 : parseFloat(p[3])) : 1; return toSrgb(L, C*Math.cos(H), C*Math.sin(H), al) }
    m = c.match(/^oklab\\(([^)]+)\\)/)
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean); const L = p[0].endsWith('%') ? parseFloat(p[0])/100 : parseFloat(p[0]); const al = p[3] ? parseFloat(p[3]) : 1; return toSrgb(L, parseFloat(p[1]), parseFloat(p[2]), al) }
    return null
  }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }; return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b) }
  const blend = (top, bot) => ({ r: top.r*top.a + bot.r*(1-top.a), g: top.g*top.a + bot.g*(1-top.a), b: top.b*top.a + bot.b*(1-top.a), a: 1 })
  const bgOf = (el) => {
    const stack = []
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base)
    return base
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('.sr-only') }
  const lowContrast = []
  let checked = 0
  for (const el of document.querySelectorAll('main h1, main h2, main p, main dt, main dd, main td, main th, main li, main a, main label, main span, main button')) {
    if (!visible(el) || !el.textContent.trim() || el.children.length > 3) continue
    const fg = parse(getComputedStyle(el).color); if (!fg) continue
    const bg = bgOf(el); const f = blend(fg, bg)
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    const size = parseFloat(getComputedStyle(el).fontSize), bold = Number(getComputedStyle(el).fontWeight) >= 700
    const min = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
    checked++
    if (ratio < min) lowContrast.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio*100)/100 })
  }
  const controls = [...document.querySelectorAll('main input, main select, main textarea')].filter(visible)
  const unlabeled = controls.filter((c) => !(c.id && document.querySelector('label[for="' + c.id + '"]')) && !c.getAttribute('aria-label') && !c.closest('label')).map((c) => c.name || c.id || c.tagName)
  const buttonsNoName = [...document.querySelectorAll('button, a[href]')].filter(visible).filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).length
  const forms = [...document.querySelectorAll('main form')].map((f) => ({ method: (f.getAttribute('method') || 'get').toLowerCase(), action: f.getAttribute('action') }))
  const text = document.body.innerText
  return {
    path: location.pathname + location.search,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    h1: [...document.querySelectorAll('main h1')].map((h) => h.textContent.trim()),
    lowContrast, contrastChecked: checked, unlabeled, buttonsNoName, forms,
    mobileMenuButton: !!document.querySelector('button[aria-label*="menu" i], button[aria-label*="Menu" i]'),
    stillLoading: /Carregando/.test(text) && !document.querySelector('main h1'),
    hasForbiddenTerms: /Saldo dispon[ií]vel|Solicitar saque|Chave Pix/i.test(text),
    hasWireframeMarker: /DADOS SINT[ÉE]TICOS|WIREFRAME/i.test(text),
    hasDefaultsShown: /R\\$\\s?(30|50|22),00/.test(text) && !/Lab Demo/.test(text),
  }
})()`
