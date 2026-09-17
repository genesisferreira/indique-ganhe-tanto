/**
 * PostgreSQL local descartável em 127.0.0.1:55434.
 * Não usa DATABASE_URL nem credenciais do projeto.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(here, "../..")
const labRoot = "D:\\igt-pg-3-1e-l"
const dataDir = join(labRoot, "data-m")
export const CONN_FILE = join(labRoot, "connection.json")

const PORT = 55434
const HOST = "127.0.0.1"
const USER = "postgres"
const PASSWORD = "igt_local_only_not_prod"
const DATABASE = "igt_collections_31el"

let cluster
let ownerClient

function assertLocal(target) {
  const text = String(target ?? "")
  if (!text.includes("127.0.0.1") && !text.includes("localhost")) {
    throw new Error(`Recusa destino não local: ${text}`)
  }
}

async function loadPg() {
  const EmbeddedPostgres = (
    await import(pathToFileURL(join(labRoot, "node_modules/embedded-postgres/dist/index.js")).href)
  ).default
  const pgMod = await import(pathToFileURL(join(labRoot, "node_modules/pg/lib/index.js")).href)
  const Client = pgMod.default?.Client ?? pgMod.Client
  return { EmbeddedPostgres, Client }
}

export async function startCollectionsLab() {
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  const { EmbeddedPostgres, Client } = await loadPg()
  cluster = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: () => undefined,
    onError: (message) => process.stderr.write(`[pg:err] ${String(message)}\n`),
  })
  await cluster.initialise()
  await cluster.start()

  const admin = cluster.getPgClient("postgres", HOST)
  await admin.connect()
  const listen = await admin.query("show listen_addresses")
  assertLocal(listen.rows[0].listen_addresses)
  try {
    await cluster.createDatabase(DATABASE)
  } catch {
    /* already exists in this process */
  }
  await admin.end()

  ownerClient = new Client({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
  })
  await ownerClient.connect()
  await ownerClient.query("set client_encoding to 'UTF8'")
  const inet = await ownerClient.query(
    "select inet_server_addr() as addr, current_setting('listen_addresses') as listen, current_setting('server_version') as version"
  )
  assertLocal(String(inet.rows[0].addr))
  assertLocal(String(inet.rows[0].listen))

  const files = [
    "scripts/local-pg-collections-lab/bootstrap.sql",
    "supabase/schema.sql",
    "supabase/rls-policies.sql",
    "supabase/patch-commercial-lead-distribution.sql",
    "supabase/patch-employee-sector-foundation.sql",
    "supabase/patch-generic-sector-assignment-engine.sql",
    "supabase/patch-collections-retention-foundation.sql",
    "supabase/patch-collection-discovery-checkpoint.sql",
    "supabase/patch-collection-discovery-fenced-persist.sql",
    "supabase/patch-collection-discovery-reconciliation.sql",
  ]
  for (const rel of files) {
    const sql = readFileSync(join(REPO_ROOT, rel), "utf8")
    await ownerClient.query(sql)
  }

  const conn = {
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
    listenAddresses: inet.rows[0].listen,
    serverAddr: String(inet.rows[0].addr),
    serverVersion: inet.rows[0].version,
    localTargetVerified: true,
  }
  writeFileSync(CONN_FILE, JSON.stringify(conn, null, 2))
  return { client: ownerClient, conn, Client }
}

export async function stopCollectionsLab() {
  if (ownerClient) {
    await ownerClient.end().catch(() => undefined)
    ownerClient = null
  }
  if (cluster) {
    await Promise.race([
      cluster.stop(),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]).catch(() => undefined)
    cluster = null
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { conn } = await startCollectionsLab()
  process.stdout.write(`READY ${JSON.stringify(conn)}\n`)
  if (process.argv.includes("--keep")) {
    process.stdout.write("KEEP until SIGINT\n")
    await new Promise(() => undefined)
  } else {
    await stopCollectionsLab()
  }
}
