import { existsSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const SERVER_ONLY = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "server-only-stub.mjs")).href

function existingUrl(abs) {
  const candidates = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, join(abs, "index.ts")]
  for (const file of candidates) {
    if (existsSync(file)) return pathToFileURL(file).href
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: SERVER_ONLY }
  }
  if (specifier.startsWith("@/")) {
    const url = existingUrl(join(ROOT, specifier.slice(2)))
    if (url) return { shortCircuit: true, url }
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parent = fileURLToPath(context.parentURL)
    const url = existingUrl(resolvePath(dirname(parent), specifier))
    if (url) return { shortCircuit: true, url }
  }
  return nextResolve(specifier, context)
}
