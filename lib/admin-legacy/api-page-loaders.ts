/**
 * 3.1F-K1S — loaders CLIENT-SIDE de /admin/comerciais e /admin/indicacoes via rota de API.
 *
 * Mesmo padrão de /admin/funcionarios: `fetch(url, { signal, cache: "no-store" })` com o signal do
 * AbortController do carregamento (timeout/desmontagem/retry cancelam o request real). Não usa o cliente
 * Supabase do navegador, logo não disputa o lock de auth (navigator.locks) com o app shell (K2).
 * Este módulo não importa services (nada de supabase-js no caminho de carga da página).
 *
 * Regras mantidas: erro/shape inválido => erro (nunca lista vazia); `empty` só com lista válida vazia.
 */
import {
  classifyHttpStatus,
  dataOutcome,
  errorOutcome,
  fetchJsonForLoader,
  listOutcome,
  type LoadOutcome,
} from "@/lib/client/guarded-loader"
import type { AdminIndicacoesBundle } from "@/lib/admin-legacy/indicacoes-loader"
import type { Comercial, Indicacao } from "@/types"

export const ADMIN_COMERCIAIS_API = "/api/admin/comerciais"
export const ADMIN_INDICACOES_API = "/api/admin/indicacoes"

/** Campos `Date` dos tipos Indicacao/Comercial/User/Plano (JSON os transforma em string ISO). */
const DATE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "publicPreRegistrationAt",
  "brbyteInteressadoCreatedAt",
  "brbyteInteressadoLastSyncAt",
  "brbyteClientSyncedAt",
  "brbyteFirstInvoicePaidAt",
  "brbyteLastErrorAt",
  "dataPrimeiraFaturaPaga",
  "dataAprovacao",
  "dataRecusa",
  "atribuidoEm",
  "primeiroContatoEm",
  "lastRedistributedAt",
  "cienteTaxasInstalacaoEm",
  "cienteDiferencaContratacaoEm",
])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

/** Restaura `Date` somente em chaves conhecidas com string ISO (JSON.stringify(Date)). */
export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => reviveDates(v)) as unknown as T
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = DATE_KEYS.has(k) && typeof v === "string" && ISO_DATE.test(v) ? new Date(v) : reviveDates(v)
  }
  return out as T
}

function hasStringId(item: unknown): boolean {
  return Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
}

export async function fetchComerciaisPageOutcome(
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<LoadOutcome<Comercial[]>> {
  const res = await fetchJsonForLoader(ADMIN_COMERCIAIS_API, signal, fetchImpl)
  if (!res.ok) return errorOutcome<Comercial[]>(classifyHttpStatus(res.status))
  const body = res.json as { ok?: unknown; items?: unknown } | null
  if (!body || body.ok !== true || !Array.isArray(body.items)) return errorOutcome<Comercial[]>("invalid_response")
  return listOutcome<Comercial>(reviveDates(body.items), hasStringId)
}

export async function fetchIndicacoesPageOutcome(
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<LoadOutcome<AdminIndicacoesBundle>> {
  const res = await fetchJsonForLoader(ADMIN_INDICACOES_API, signal, fetchImpl)
  if (!res.ok) return errorOutcome<AdminIndicacoesBundle>(classifyHttpStatus(res.status))
  const body = res.json as { ok?: unknown; bundle?: unknown } | null
  const b = body?.bundle as Partial<AdminIndicacoesBundle> | undefined
  if (
    !body ||
    body.ok !== true ||
    !b ||
    !Array.isArray(b.lista) ||
    !b.lista.every(hasStringId) ||
    !Array.isArray(b.comerciais) ||
    typeof b.comerciaisDisponiveis !== "boolean" ||
    typeof b.role !== "string"
  ) {
    return errorOutcome<AdminIndicacoesBundle>("invalid_response")
  }
  const bundle: AdminIndicacoesBundle = {
    lista: reviveDates(b.lista as Indicacao[]),
    comerciais: reviveDates(b.comerciais as Comercial[]),
    comerciaisDisponiveis: b.comerciaisDisponiveis,
    role: b.role,
  }
  return dataOutcome(bundle, bundle.lista.length === 0)
}
