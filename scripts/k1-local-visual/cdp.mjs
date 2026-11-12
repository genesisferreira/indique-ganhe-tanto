// 3.1F-K1 — driver CDP mínimo (Edge/Chrome headless, somente 127.0.0.1) com eventos e interceptação.
// Interceptação (Fetch) usada SOMENTE no lab para simular loading/erro/timeout/vazio. Sem JS de mutação.
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launchK1Browser(executable, port = 9343) {
  const profile = mkdtempSync(join(tmpdir(), "igt-k1-cdp-"))
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
  const listeners = new Set()
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString())
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result) }
    else if (msg.method) for (const l of [...listeners]) l(msg)
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

  // Contador de requisições (somente leitura): método + caminho, sem query string nem corpo.
  const requests = []
  on((m) => {
    if (m.method === "Network.requestWillBeSent") {
      const u = new URL(m.params.request.url)
      requests.push({ method: m.params.request.method, host: u.host, path: u.pathname })
    }
  })
  await send("Page.enable")
  await send("Network.enable")
  await send("Runtime.enable")

  let rules = []
  const held = []
  on(async (m) => {
    if (m.method !== "Fetch.requestPaused") return
    const { requestId, request } = m.params
    const rule = rules.find((r) => r.match(request))
    try {
      if (!rule || request.method === "OPTIONS") return await send("Fetch.continueRequest", { requestId })
      if (rule.action === "hang") { held.push(requestId); return }
      const origin = rule.origin
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: rule.status,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          ...(origin ? [{ name: "Access-Control-Allow-Origin", value: origin }, { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Expose-Headers", value: "*" }] : []),
          { name: "Cache-Control", value: "no-store" },
        ],
        body: Buffer.from(rule.body ?? "{}").toString("base64"),
      })
    } catch { /* página navegou */ }
  })

  return {
    version: ver.Browser,
    send,
    requests,
    async intercept(nextRules) {
      for (const requestId of held.splice(0)) await send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => {})
      rules = nextRules
      if (rules.length) await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] })
      else await send("Fetch.disable").catch(() => {})
    },
    async setCookie(name, value, url) {
      await send("Network.clearBrowserCookies")
      if (name) {
        const u = new URL(url)
        await send("Network.setCookie", { name, value, url, path: "/", sameSite: "Lax", sourceScheme: "NonSecure", sourcePort: Number(u.port || 80) })
      }
    },
    async open(url, width, height, settleMs = 2500) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 })
      await send("Page.navigate", { url })
      await sleep(settleMs)
    },
    async evaluate(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    },
    async key(key, code, vk) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk })
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk })
    },
    async screenshot() {
      const m = await send("Page.getLayoutMetrics")
      const w = Math.ceil(m.cssLayoutViewport.clientWidth), h = Math.min(6000, Math.ceil(m.cssContentSize.height))
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
      return Buffer.from(r.data, "base64")
    },
    async close() { try { ws.close() } catch {} proc.kill(); await sleep(500) },
  }
}
