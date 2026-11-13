// 3.1F-K1B — gate da regressão comparável (baseline × candidato), mesmo comando e mesma regra de manifest.
// Uso: node k1b-manifest-compare.mjs <baseline.json> <candidato.json> <arquivos-alterados.txt> [--out gate.json]
// Regras:
//  - mesmo comando, mesma regra de coleta, mesmo Node/pnpm, mesmo alias loader (hash LF) — senão MANIFEST_MISMATCH;
//  - nenhum arquivo do baseline pode sumir (SUITE_DISAPPEARED);
//  - arquivo novo no candidato só se constar na lista de alterados;
//  - arquivo com conteúdo diferente: "crlf_only" (hash LF igual) ou "changed" (deve constar na lista de alterados);
//  - toda falha do candidato deve reproduzir no baseline (mesmo arquivo, mesmo teste) — senão NEW_FAILURE;
//  - arquivos alterados/novos não podem falhar;
//  - arquivo inalterado deve ter o mesmo número de testes e não mais skips (sem desaparecimento silencioso).
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
const [baseP, candP, changedP] = process.argv.slice(2)
const outI = process.argv.indexOf("--out")
const base = JSON.parse(readFileSync(baseP, "utf8"))
const cand = JSON.parse(readFileSync(candP, "utf8"))
const changed = new Set(readFileSync(changedP, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
const issues = []
const notes = []
const same = (k, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) issues.push({ kind: "MANIFEST_MISMATCH", what: k, base: a, cand: b }) }
same("command", base.command, cand.command)
same("manifest.rule", base.manifest.rule, cand.manifest.rule)
same("node", base.node, cand.node)
same("pnpm", base.pnpm, cand.pnpm)
same("loader", base.loader, cand.loader)
same("runner.sha256", base.runner.sha256, cand.runner.sha256)
same("pgLab", base.pgLab ?? null, cand.pgLab ?? null)
same("extraImport.sha256", base.extraImport?.sha256 ?? null, cand.extraImport?.sha256 ?? null)
// manifest do candidato projetado nos arquivos do baseline deve ter EXATAMENTE o hash da lista do baseline
const projected = cand.manifest.files.filter((f) => base.manifest.files.includes(f))
const projectedSha256 = createHash("sha256").update(projected.join("\n")).digest("hex")
if (projectedSha256 !== base.manifest.listSha256) issues.push({ kind: "MANIFEST_MISMATCH", what: "projectedListSha256", base: base.manifest.listSha256, cand: projectedSha256 })
const B = new Map(base.perFile.map((f) => [f.file, f]))
const C = new Map(cand.perFile.map((f) => [f.file, f]))
for (const f of B.keys()) if (!C.has(f)) issues.push({ kind: "SUITE_DISAPPEARED", file: f })
const added = [...C.keys()].filter((f) => !B.has(f))
for (const f of added) if (!changed.has(f)) issues.push({ kind: "UNEXPECTED_NEW_FILE", file: f })
const classification = { identical: 0, crlf_only: [], changed: [] }
for (const [f, c] of C) {
  const b = B.get(f)
  const isChanged = changed.has(f)
  if ((isChanged || !b) && (c.exit !== 0 || (c.fail ?? 0) > 0)) issues.push({ kind: "CHANGED_FILE_FAILS", file: f, fail: c.fail, exit: c.exit })
  if (!b) continue
  if (b.sha256 === c.sha256) classification.identical++
  else if (b.sha256LF === c.sha256LF) classification.crlf_only.push(f)
  else { classification.changed.push(f); if (!isChanged) issues.push({ kind: "UNEXPECTED_CONTENT_CHANGE", file: f }) }
  const bFail = new Set(b.failing)
  for (const t of c.failing) if (!bFail.has(t)) issues.push({ kind: "NEW_FAILURE", file: f, test: t })
  if (c.exit !== 0 && b.exit === 0) issues.push({ kind: "NEW_FAILURE", file: f, test: `(exit ${c.exit})` })
  if (!isChanged && b.sha256LF === c.sha256LF) {
    if (b.tests !== c.tests) issues.push({ kind: "TEST_COUNT_CHANGED", file: f, base: b.tests, cand: c.tests })
    if ((c.skipped ?? 0) > (b.skipped ?? 0)) issues.push({ kind: "MORE_SKIPS", file: f, base: b.skipped, cand: c.skipped })
  }
  if (b.failing.length) notes.push({ file: f, baselineFailing: b.failing, candidateFailing: c.failing, reproduces: c.failing.every((t) => bFail.has(t)) })
}
const gate = {
  ok: issues.length === 0,
  baseline: { root: base.root, files: base.manifest.count, listSha256: base.manifest.listSha256, totals: base.totals, durationMs: base.durationMs, exitCode: base.exitCode },
  candidate: { root: cand.root, files: cand.manifest.count, listSha256: cand.manifest.listSha256, totals: cand.totals, durationMs: cand.durationMs, exitCode: cand.exitCode },
  sameCommand: base.command === cand.command, command: cand.command, node: cand.node, pnpm: cand.pnpm, loader: cand.loader, runnerSha256: cand.runner.sha256,
  manifestProjection: { baselineListSha256: base.manifest.listSha256, candidateProjectedOnBaselineSha256: projectedSha256, equal: projectedSha256 === base.manifest.listSha256, count: projected.length },
  pgLab: cand.pgLab ?? null, extraImport: cand.extraImport ?? null,
  baselineFilesAllPresentInCandidate: [...B.keys()].every((f) => C.has(f)),
  addedFiles: added,
  classification,
  preexistingFailures: notes,
  newFailures: issues.filter((i) => i.kind === "NEW_FAILURE"),
  issues,
}
if (outI > 0) writeFileSync(process.argv[outI + 1], JSON.stringify(gate, null, 1))
process.stdout.write(JSON.stringify({ ok: gate.ok, baseline: gate.baseline.totals, candidate: gate.candidate.totals, added: added.length, crlfOnly: classification.crlf_only.length, changed: classification.changed, newFailures: gate.newFailures.length, issues: issues.slice(0, 20) }, null, 1) + "\n")
process.exit(gate.ok ? 0 : 1)
