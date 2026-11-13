// 3.1F-K1B — testes de mutação dos testes de abort.
// Para cada mutação: copia lib/hooks/components/types + alias loader para uma pasta temporária
// (node_modules por junção/symlink, somente leitura), aplica UMA alteração textual e roda
// lib/admin-legacy/k1b-abort.test.ts. A mutação deve DERRUBAR a suíte (exit != 0).
// Controle: a cópia sem mutação deve passar. Não altera o repositório.
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TEST = "lib/admin-legacy/k1b-abort.test.ts"
const COPY = ["lib", "hooks", "components", "types", "scripts/local-pg-collections-lab", "package.json", "tsconfig.json"]

const MUTATIONS = [
  { id: "M1_service_signal_not_attached", file: "lib/services/supabase-data.service.ts", from: "return signal ? query.abortSignal(signal) : query", to: "return query" },
  { id: "M2_loader_controller_not_attached", file: "lib/client/guarded-loader.ts", from: "options.load({ signal: controller.signal, attempt: mySeq })", to: "options.load({ signal: new AbortController().signal, attempt: mySeq })" },
  { id: "M3_bundle_drops_signal_to_referrals", file: "lib/admin-legacy/indicacoes-loader.ts", from: "deps.loadReferrals({ identity, signal })", to: "deps.loadReferrals({ identity })" },
  { id: "M4_fetch_without_signal", file: "lib/client/guarded-loader.ts", from: '{ cache: "no-store", signal, credentials: "same-origin" }', to: '{ cache: "no-store", credentials: "same-origin" }' },
  { id: "M5_page_loader_drops_signal", file: "lib/admin-legacy/page-loaders.ts", from: "await load({ signal })", to: "await load({})" },
  { id: "M6_service_ignores_abort_partial_success", file: "lib/services/supabase-data.service.ts", from: /^\s*if \(signal\?\.aborted\) return abortedResult\(\)\s*$/gm, to: "" },
  { id: "M7_timeout_treated_as_unmount", file: "lib/client/guarded-loader.ts", from: 'if (timedOut || loaderAbortKind(controller.signal) === "timeout") final = { status: "timeout" }', to: 'if (false) final = { status: "timeout" }' },
  // Desmontagem sem alerta tem 2 defesas (final=null para abort + emit bloqueado após dispose); a falha real exige remover ambas.
  { id: "M8_unmount_shows_error", file: "lib/client/guarded-loader.ts", edits: [
    ["else if (controller.signal.aborted) final = null", 'else if (controller.signal.aborted) final = { status: "error", errorClass: "unexpected" }'],
    ["if (disposed || mySeq !== seq) return", "if (mySeq !== seq) return"],
  ] },
  { id: "M9_abort_listener_not_removed", file: "lib/client/guarded-loader.ts", from: 'controller.signal.removeEventListener("abort", onAbort)', to: "void onAbort" },
  { id: "M10_retry_does_not_abort_previous", file: "lib/client/guarded-loader.ts", from: 'current.abort(new LoaderAbortReason("superseded"))', to: "void 0" },
]

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "igt-k1b-mut-"))
  for (const p of COPY) cpSync(join(ROOT, p), join(dir, p), { recursive: true })
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir")
  return dir
}
function runTest(dir) {
  const r = spawnSync(process.execPath, ["--import", "./scripts/local-pg-collections-lab/alias-register.mjs", "--experimental-strip-types", "--experimental-test-module-mocks", "--test", "--test-reporter=tap", TEST], { cwd: dir, encoding: "utf8", timeout: 180_000 })
  const out = `${r.stdout}\n${r.stderr}`
  const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, "m")) || [])[1] ?? NaN)
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
  return { exit: r.status, tests: num("tests"), pass: num("pass"), fail: num("fail"), cancelled: num("cancelled"), skipped: num("skipped"), failed: failed.slice(0, 12) }
}

const results = []
let ok = true
const control = workspace()
try {
  const c = runTest(control)
  const pass = c.exit === 0 && c.fail === 0 && c.tests > 0 && c.skipped === 0
  results.push({ id: "CONTROL_unmutated", expected: "pass", ...c, verdict: pass ? "OK" : "FAIL" })
  if (!pass) ok = false
} finally { rmSync(control, { recursive: true, force: true }) }

for (const m of MUTATIONS) {
  const dir = workspace()
  try {
    const f = join(dir, m.file)
    const src = readFileSync(f, "utf8")
    const mutated = (m.edits ?? [[m.from, m.to]]).reduce((acc, [from, to]) => acc.replace(from, to), src)
    if (m.edits && m.edits.some(([from]) => !src.includes(from))) { results.push({ id: m.id, verdict: "FAIL", reason: "mutação composta não aplicada" }); ok = false; continue }
    if (mutated === src) { results.push({ id: m.id, verdict: "FAIL", reason: "mutação não aplicada (padrão não encontrado)" }); ok = false; continue }
    writeFileSync(f, mutated)
    const r = runTest(dir)
    // Teste cancelado (promise nunca resolvida, ex.: request anterior nunca abortado) também derruba a suíte.
    const killed = r.exit !== 0 && (r.fail > 0 || r.cancelled > 0)
    results.push({ id: m.id, file: m.file, expected: "fail", ...r, verdict: killed ? "KILLED" : "SURVIVED" })
    if (!killed) ok = false
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const out = process.env.K1B_MUTATION_OUT
if (out) writeFileSync(out, JSON.stringify({ ok, results }, null, 1))
for (const r of results) process.stdout.write(`${r.verdict.padEnd(8)} ${r.id} exit=${r.exit} tests=${r.tests} fail=${r.fail} cancelled=${r.cancelled}${r.failed?.length ? " :: " + r.failed.slice(0, 3).join(" | ") : ""}${r.reason ? " :: " + r.reason : ""}\n`)
process.stdout.write(`[k1b-mutation] ${ok ? "OK" : "FAIL"} ${results.filter((r) => r.verdict === "KILLED").length}/${MUTATIONS.length} mutações derrubaram a suíte; controle ${results[0].verdict}\n`)
process.exit(ok ? 0 : 1)
