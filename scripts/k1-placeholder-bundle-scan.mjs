// 3.1F-K1 — varredura do bundle (.next) por percentuais placeholder removidos.
// Uso: node scripts/k1-placeholder-bundle-scan.mjs [diretório .next]
// Somente leitura. Sai com código 1 se encontrar qualquer padrão proibido.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const NEXT_DIR = resolve(process.argv[2] || ".next")
const TARGETS = ["static", "server/app"].map((d) => join(NEXT_DIR, d))
const PATTERNS = [
  ["+12%", /\+12%/],
  ["+5.2%/+5,2%", /\+5[.,]2%/],
  ["+12.5%/+12,5%", /\+12[.,]5%/],
  ["+15%", /\+15%/],
  ["+8.2%/+8,2%", /\+8[.,]2%/],
  ["vs mes anterior", /vs m[eê]s anterior/i],
  ["trend literal {value:N,isPositive}", /value:\s*(12|5\.2|12\.5|15|8\.2)\s*,\s*(isPositive|label)/],
  // StatCard legacy trend prop (e.g. `n.isPositive??n.value>=0`, `isPositive:!0`).
  // Third-party math libs define `x.isPositive=x.ispos=function` — not a trend; ignored.
  ["isPositive (StatCard trend prop)", /isPositive\s*(\?\?|:\s*(!0|!1|true|false))/],
]

function* walk(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(js|mjs|html|rsc|json|txt)$/.test(name)) yield p
  }
}

let files = 0
const hits = []
for (const dir of TARGETS) {
  for (const file of walk(dir)) {
    files++
    const src = readFileSync(file, "utf8")
    for (const [label, re] of PATTERNS) {
      const m = re.exec(src)
      if (m) hits.push({ label, file: file.slice(NEXT_DIR.length + 1), context: src.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") })
    }
  }
}
console.log(JSON.stringify({ nextDir: NEXT_DIR, filesScanned: files, hits }, null, 2))
if (files === 0) { console.error("nenhum arquivo varrido — build ausente?"); process.exit(2) }
process.exit(hits.length ? 1 : 0)
