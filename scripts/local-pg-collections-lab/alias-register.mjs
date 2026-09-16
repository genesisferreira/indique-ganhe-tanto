import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "alias-loader.mjs")).href)
