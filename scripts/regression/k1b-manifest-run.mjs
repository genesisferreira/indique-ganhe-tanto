// 3.1F-K1B — regressão comparável: UM comando, UM manifest.
// Uso (idêntico para baseline e candidato; muda só --root):
//   node <este-arquivo> --root <archive limpo> --out <json>
// Coleta: todo arquivo *.test.{ts,tsx,mts,cts,mjs,cjs,js} sob --root, exceto node_modules/.next/.git.
// Execução: um processo por arquivo, sequencial, com o MESMO comando:
//   node --import ./scripts/local-pg-collections-lab/alias-register.mjs --experimental-strip-types
//        --experimental-test-module-mocks --test --test-reporter=tap <arquivo>
// Ambiente: variáveis de Supabase/DB/ERP removidas (nenhuma conexão remota possível) e variáveis de lab
// (IGT_PG_*, K1_*, J2_*) removidas. Lab PG de Collections: --pg-port / --pg-lab-root descrevem o lab que as
// suítes usarão (padrão 127.0.0.1:55434 em %LOCALAPPDATA%\igt-pg-collections-lab). Para usar outra porta/diretório
// sem tocar no harness versionado, passe --node-import <hook externo> (mesmo hook nos dois lados; sha registrado).
// Timeout por arquivo: 25 min; no timeout somente o processo node filho é encerrado (child.kill). Postgres
// NUNCA é morto: a única parada é `pg_ctl stop -D <pg-lab-root>/data-m`; porta ainda ocupada => STOP (exit 3).
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const ROOT = resolve(arg("--root", process.cwd()))
const OUT = arg("--out", null)
const PER_FILE_TIMEOUT_MS = 1_500_000
const PG_PORT = Number(arg("--pg-port", "55434"))
const PG_LAB_ROOT = resolve(arg("--pg-lab-root", join(process.env.LOCALAPPDATA || os.homedir(), "igt-pg-collections-lab")))
const EXTRA_IMPORT = arg("--node-import", null)
if (!Number.isInteger(PG_PORT) || PG_PORT < 1024) throw new Error("--pg-port inválida")
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "coverage"])
const TEST_RE = /\.test\.(ts|tsx|mts|cts|mjs|cjs|js)$/
const LOADER = "./scripts/local-pg-collections-lab/alias-register.mjs"
const NODE_ARGS = [...(EXTRA_IMPORT ? ["--import", pathToFileURL(resolve(EXTRA_IMPORT)).href] : []), "--import", LOADER, "--experimental-strip-types", "--experimental-test-module-mocks", "--test", "--test-reporter=tap"]
const sha = (b) => createHash("sha256").update(b).digest("hex")

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (TEST_RE.test(name)) acc.push(relative(ROOT, p).split(sep).join("/"))
  }
  return acc
}

const env = { ...process.env }
for (const k of Object.keys(env)) if (/SUPABASE|DATABASE_URL|PGHOST|PGPASSWORD|BRBYTE|CONTROLLR|ERP_|VERCEL|^IGT_PG_|^K1_|^K1B_|^J2_/i.test(k)) delete env[k]
env.NODE_ENV = "test"

const files = walk(ROOT).sort()
const pnpm = spawnSync(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", "--version"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" })
const loaderFiles = ["scripts/local-pg-collections-lab/alias-register.mjs", "scripts/local-pg-collections-lab/alias-loader.mjs"]
// Lab Collections: NUNCA matar postgres. Única parada permitida: pg_ctl stop -D <PG_LAB_ROOT>/data-m.
const PG_DATA = join(PG_LAB_ROOT, "data-m")
const PG_CTL = join(PG_LAB_ROOT, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin", "pg_ctl.exe")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function portListening() {
  if (process.platform !== "win32") return false
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `@(Get-NetTCPConnection -State Listen -LocalPort ${PG_PORT} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" })
  return (Number((r.stdout || "0").trim()) || 0) > 0
}
async function ensureLabStopped(stage) {
  const info = { stage, port: PG_PORT, listeningBefore: portListening(), pgCtlStop: null, listeningAfter: null }
  if (!info.listeningBefore) return info
  for (let i = 0; i < 15 && portListening(); i++) await sleep(1000) // o after() do teste pode estar encerrando
  if (portListening() && existsSync(PG_CTL) && existsSync(join(PG_DATA, "postmaster.pid"))) {
    const r = spawnSync(PG_CTL, ["stop", "-D", PG_DATA, "-m", "fast", "-w", "-t", "60"], { encoding: "utf8" })
    info.pgCtlStop = { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 200) }
    for (let i = 0; i < 15 && portListening(); i++) await sleep(1000)
  }
  info.listeningAfter = portListening()
  if (info.listeningAfter) {
    process.stdout.write(`STOP LAB_PORT_BLOCKED stage=${stage} :: porta ${PG_PORT} ainda ocupada após pg_ctl stop -D; nenhum processo postgres foi morto\n`)
    if (OUT) writeFileSync(OUT + ".blocked.json", JSON.stringify(info, null, 2))
    process.exit(3)
  }
  return info
}
function runFile(file) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [...NODE_ARGS, file], { cwd: ROOT, env, detached: process.platform !== "win32" })
    let stdout = "", stderr = "", timedOut = false
    child.stdout.on("data", (d) => { stdout += d })
    child.stderr.on("data", (d) => { stderr += d })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, PER_FILE_TIMEOUT_MS)
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, stdout, stderr, timedOut }) })
  })
}

const perFile = []
const t0 = Date.now()
const labStops = { beforeRun: await ensureLabStopped("beforeRun"), perFile: {} }
for (const file of files) {
  const raw = readFileSync(join(ROOT, file))
  const lf = Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"))
  const s = Date.now()
  const r = await runFile(file)
  const stop = await ensureLabStopped(file)
  if (stop.listeningBefore) labStops.perFile[file] = stop
  const orphans = stop.listeningBefore ? 1 : 0
  const out = `${r.stdout ?? ""}`
  const num = (k) => { const m = out.match(new RegExp(`^# ${k} (\\d+)`, "m")); return m ? Number(m[1]) : null }
  const failing = [...out.matchAll(/^(\s*)not ok \d+ - (.+?)(\s+#.*)?$/gm)].map((m) => `${m[1].length / 4}:${m[2].trim()}`)
  perFile.push({
    file, sha256: sha(raw), sha256LF: sha(lf), exit: r.status, signal: r.signal ?? null, timedOut: r.timedOut, labLeftRunning: orphans,
    tests: num("tests"), suites: num("suites"), pass: num("pass"), fail: num("fail"), cancelled: num("cancelled"), skipped: num("skipped"), todo: num("todo"),
    ms: Date.now() - s, failing, stderrTail: (r.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-3).map((l) => l.slice(0, 200)),
  })
  process.stdout.write(`${r.status === 0 ? "ok  " : "FAIL"} ${file} tests=${num("tests")} fail=${num("fail")} cancelled=${num("cancelled")} skip=${num("skipped")} ${Date.now() - s}ms${r.timedOut ? " TIMEOUT" : ""}${orphans ? ` labStoppedViaPgCtl` : ""}\n`)
}
const sum = (k) => perFile.reduce((n, f) => n + (f[k] ?? 0), 0)
const report = {
  command: `node ${NODE_ARGS.join(" ")} <file>   (cwd=--root; 1 processo por arquivo, sequencial)`,
  runner: { file: "scripts/regression/k1b-manifest-run.mjs", sha256: sha(readFileSync(new URL(import.meta.url))) },
  root: ROOT,
  node: process.version,
  pnpm: (pnpm.stdout || "").trim() || null,
  os: `${os.platform()} ${os.release()}`,
  loader: Object.fromEntries(loaderFiles.map((f) => [f, existsSync(join(ROOT, f)) ? sha(Buffer.from(readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n"))) : null])),
  manifest: { rule: "**/*.test.{ts,tsx,mts,cts,mjs,cjs,js} excluindo node_modules,.next,.git,.turbo,coverage", count: files.length, listSha256: sha(files.join("\n")), files },
  totals: { files: files.length, tests: sum("tests"), pass: sum("pass"), fail: sum("fail"), cancelled: sum("cancelled"), skipped: sum("skipped"), todo: sum("todo"), filesFailing: perFile.filter((f) => f.exit !== 0).length },
  durationMs: Date.now() - t0,
  perFileTimeoutMs: PER_FILE_TIMEOUT_MS,
  pgLab: { port: PG_PORT, labRoot: PG_LAB_ROOT, dataDir: PG_DATA },
  extraImport: EXTRA_IMPORT ? { path: resolve(EXTRA_IMPORT), sha256: sha(readFileSync(resolve(EXTRA_IMPORT))) } : null,
  labStops,
  exitCode: perFile.every((f) => f.exit === 0) ? 0 : 1,
  perFile,
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1))
process.stdout.write(`[manifest] files=${files.length} list=${report.manifest.listSha256.slice(0, 12)} tests=${report.totals.tests} pass=${report.totals.pass} fail=${report.totals.fail} skip=${report.totals.skipped} cancelled=${report.totals.cancelled} filesFailing=${report.totals.filesFailing} ${report.durationMs}ms exit=${report.exitCode}\n`)
process.exit(report.exitCode)
