/**
 * Sprint 3.1E-BD — atualização do resumo/blocos pelo SERVIDOR após cada
 * segmento de "Carregar próxima leva" (puro + fetch injetado; sem React).
 *
 * Causa raiz da BC1 (UI 15/2/13 com banco 15/3/12): o cliente só relia o
 * resumo dentro de `load()` no `finally` do laço — nunca entre segmentos — e
 * `load()` encerrava antes de chamar `loadSummary()` sempre que
 * /api/cobranca/cases falhava ou lançava (sem try/catch), deixando o último
 * valor pré-operação na tela como se fosse atual, sem indicação de erro.
 *
 * Regras:
 * - após CADA segmento (awaiting_next e qualquer status terminal) relê do
 *   servidor: resumo de capacidade + estado durável da operação (GET
 *   next-batch) e casos/blocos (GET cases). Somente GET: nenhum POST, nenhum
 *   segmento, nenhuma chamada ao ERP;
 * - nada é incrementado no cliente: o banco é a fonte de verdade;
 * - durante o refetch o estado é "refreshing" (valor antigo não é exibido);
 * - falha no refetch => "stale" (fail-closed) e o laço NÃO inicia outro
 *   segmento automaticamente.
 */
import { readCapacitySummaryResponse, type NextBatchSummary } from "@/lib/collections/next-batch"

export const NEXT_BATCH_URL = "/api/admin/collections/next-batch"
export const CASES_URL = "/api/cobranca/cases"
export const STALE_SUMMARY_MESSAGE = "Resumo desatualizado — atualizar"

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: "no-store" }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

export type CasesSnapshot = {
  items: unknown[]
  dashboard: Record<string, number> | null
  kind: string
}

export type ServerRefreshResult =
  | { ok: true; summary: NextBatchSummary; operation: Record<string, unknown> | null; cases: CasesSnapshot }
  | { ok: false; message: string }

/** Estado exibido do resumo: refreshing/stale nunca mostram números antigos. */
export type SummaryViewState =
  | { status: "loading" }
  | { status: "refreshing" }
  | { status: "ready"; summary: NextBatchSummary }
  | { status: "stale"; message: string }
  | { status: "error"; message: string }

export async function refreshServerState(fetchFn: FetchLike): Promise<ServerRefreshResult> {
  try {
    const [sRes, cRes] = await Promise.all([
      fetchFn(NEXT_BATCH_URL, { cache: "no-store" }),
      fetchFn(CASES_URL, { cache: "no-store" }),
    ])
    const sJson = (await sRes.json().catch(() => null)) as Record<string, unknown> | null
    const cJson = (await cRes.json().catch(() => null)) as Record<string, unknown> | null
    const state = readCapacitySummaryResponse(sRes.ok, sJson)
    if (state.status !== "ready") return { ok: false, message: STALE_SUMMARY_MESSAGE }
    if (!cRes.ok || !cJson || cJson.ok !== true) return { ok: false, message: STALE_SUMMARY_MESSAGE }
    const op = sJson?.operation
    return {
      ok: true,
      summary: state.summary,
      operation: op && typeof op === "object" && !Array.isArray(op) ? (op as Record<string, unknown>) : null,
      cases: {
        items: Array.isArray(cJson.items) ? cJson.items : [],
        dashboard: cJson.dashboard && typeof cJson.dashboard === "object" ? (cJson.dashboard as Record<string, number>) : null,
        kind: typeof cJson.kind === "string" ? cJson.kind : "member",
      },
    }
  } catch {
    return { ok: false, message: STALE_SUMMARY_MESSAGE }
  }
}

export function summaryFromRefresh(r: ServerRefreshResult): SummaryViewState {
  return r.ok ? { status: "ready", summary: r.summary } : { status: "stale", message: r.message }
}

/** Só "ready" expõe números; demais estados bloqueiam o botão (fail-closed). */
export function readySummary(state: SummaryViewState): NextBatchSummary | null {
  return state.status === "ready" ? state.summary : null
}

export type SegmentPostResult = { httpOk: boolean; json: Record<string, unknown> | null }

/**
 * Laço do cliente: UMA confirmação humana => segmentos sequenciais enquanto o
 * servidor responder continue=true. Após CADA resposta, refetch do servidor
 * antes de decidir qualquer coisa. Refetch falhou => para (sem novo segmento).
 */
export async function driveBatchSegments(input: {
  initial: Record<string, unknown>
  post: (payload: Record<string, unknown>) => Promise<SegmentPostResult>
  refresh: () => Promise<ServerRefreshResult>
  onSegment: (json: Record<string, unknown> | null, running: boolean) => void
  onRefreshing: () => void
  onRefreshed: (r: ServerRefreshResult) => void
  stopRequested: () => boolean
  guard?: number
  /** 3.1E-BG: nonce da confirmação; enviado em TODOS os segmentos da operação. */
  clientOperationNonce?: string
}): Promise<{
  last: Record<string, unknown> | null
  segmentsPosted: number
  refreshes: number
  refreshFailed: boolean
  stoppedByUser: boolean
}> {
  let payload = input.initial
  let last: Record<string, unknown> | null = null
  let segmentsPosted = 0
  let refreshes = 0
  let refreshFailed = false
  let stoppedByUser = false
  const doRefresh = async () => {
    input.onRefreshing()
    const r = await input.refresh()
    refreshes += 1
    input.onRefreshed(r)
    if (!r.ok) refreshFailed = true
    return r.ok
  }
  // Teto defensivo no cliente; a autoridade (maxSegments/nextSegment) é o servidor.
  for (let i = 0; i < (input.guard ?? 10); i++) {
    let res: SegmentPostResult
    try {
      res = await input.post(payload)
    } catch {
      res = { httpOk: false, json: null }
    }
    segmentsPosted += 1
    last = res.json
    input.onSegment(res.json, res.json?.continue === true)
    // Refetch do servidor após TODO segmento (awaiting_next e terminais).
    if (!(await doRefresh())) break
    const opId = typeof res.json?.batchOperationId === "string" ? res.json.batchOperationId : null
    const nextSegment = typeof res.json?.nextSegment === "number" ? res.json.nextSegment : null
    if (!res.httpOk || !res.json || res.json.continue !== true || !opId || nextSegment == null) break
    if (input.stopRequested()) {
      stoppedByUser = true
      let stopJson: Record<string, unknown> | null = null
      try {
        stopJson = (await input.post({ batchOperationId: opId, stop: true })).json
      } catch {
        stopJson = null
      }
      input.onSegment(stopJson ?? res.json, false)
      await doRefresh()
      break
    }
    payload = input.clientOperationNonce
      ? { batchOperationId: opId, segment: nextSegment, clientOperationNonce: input.clientOperationNonce }
      : { batchOperationId: opId, segment: nextSegment }
  }
  return { last, segmentsPosted, refreshes, refreshFailed, stoppedByUser }
}
