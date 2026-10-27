/**
 * 3.1E-AS: análise pura e sanitizada da identidade técnica do cliente nas
 * respostas de invoice/list e invoice/list_info. Nunca retorna valores,
 * amostras, hashes, mínimos/máximos — apenas contagens, tipos e classificações.
 * Não altera parsers de produção.
 */
export const CLIENT_IDENTITY_HEALTH_MODE = "client_identity_health" as const
export const CLIENT_IDENTITY_HEALTH_ATTEMPTS = 1 as const
export const CLIENT_IDENTITY_MAX_DETAIL_REQUESTS = 2 as const
export const CLIENT_IDENTITY_TIMEOUT_MIN_MS = 3_000
export const CLIENT_IDENTITY_TIMEOUT_MAX_MS = 60_000
export const CLIENT_IDENTITY_TIMEOUT_DEFAULT_MS = 60_000
/** Teto de wall-clock do probe (route maxDuration = 120s) com margem. */
export const CLIENT_IDENTITY_WALL_BUDGET_MS = 110_000
/** Orçamento mínimo restante para tentar um invoice_info. */
export const CLIENT_IDENTITY_DETAIL_MIN_BUDGET_MS = 8_000
export const CLIENT_IDENTITY_DETAIL_MARGIN_MS = 3_000

/**
 * Chaves técnicas já aceitas no repositório (invoice-from-controllr aliases +
 * caminho `client.client_pk` do modelo Controllr). Nenhum alias novo.
 * `client_pk` é o nome comprovado em create-interest / check-conversion.
 */
export const CLIENT_IDENTITY_CANDIDATE_FIELDS = [
  "client_pk",
  "clientPk",
  "id_cliente",
  "idCliente",
  "client.client_pk",
] as const
export type ClientIdentityCandidateField =
  (typeof CLIENT_IDENTITY_CANDIDATE_FIELDS)[number]

export type ClientIdentityClassification =
  | "CLIENT_ID_PROVEN_IN_LIST"
  | "CLIENT_ID_PROVEN_IN_DETAIL"
  | "CLIENT_ID_PARTIALLY_OBSERVED"
  | "CLIENT_ID_NOT_PRESENT"
  | "INCONCLUSIVE_TIMEOUT_OR_BUDGET"
  | "INVALID_RESPONSE"
  | "AUTH_OR_CONFIG_FAILURE"

export type ValueTypeName =
  | "integer"
  | "numeric_string"
  | "other_string"
  | "empty_string"
  | "non_integer_number"
  | "null"
  | "boolean"
  | "object"

export type CandidateStats = {
  field: ClientIdentityCandidateField
  presentCount: number
  absentCount: number
  nullCount: number
  validCount: number
  invalidCount: number
  distinctCount: number
  types: Partial<Record<ValueTypeName, number>>
}

export type IdentityRowInput = {
  invoicePk: string | null
  contractPk: string | null
  raw: Record<string, unknown> | null
}

type Present = { present: false } | { present: true; value: unknown }

function readCandidate(
  raw: Record<string, unknown> | null,
  field: ClientIdentityCandidateField
): Present {
  if (!raw) return { present: false }
  if (Object.prototype.hasOwnProperty.call(raw, field)) {
    return { present: true, value: raw[field] }
  }
  if (field === "client.client_pk") {
    const client = raw.client
    if (
      client &&
      typeof client === "object" &&
      !Array.isArray(client) &&
      Object.prototype.hasOwnProperty.call(client, "client_pk")
    ) {
      return { present: true, value: (client as Record<string, unknown>).client_pk }
    }
  }
  return { present: false }
}

export function classifyValueType(value: unknown): ValueTypeName {
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "non_integer_number"
  }
  if (typeof value === "string") {
    const t = value.trim()
    if (!t) return "empty_string"
    return /^\d+$/.test(t) ? "numeric_string" : "other_string"
  }
  return "object"
}

/** Chave normalizada interna (nunca exposta). Válida = inteiro positivo. */
export function normalizeClientKey(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value === "string") {
    const t = value.trim()
    if (!/^\d+$/.test(t)) return null
    const stripped = t.replace(/^0+/, "")
    return stripped ? stripped : null
  }
  return null
}

export function computeCandidateStats(
  rows: IdentityRowInput[],
  field: ClientIdentityCandidateField
): CandidateStats {
  const types: Partial<Record<ValueTypeName, number>> = {}
  const distinct = new Set<string>()
  let presentCount = 0
  let nullCount = 0
  let validCount = 0
  for (const row of rows) {
    const c = readCandidate(row.raw, field)
    if (!c.present) continue
    presentCount += 1
    const type = classifyValueType(c.value)
    types[type] = (types[type] ?? 0) + 1
    if (type === "null") nullCount += 1
    const key = normalizeClientKey(c.value)
    if (key) {
      validCount += 1
      distinct.add(key)
    }
  }
  return {
    field,
    presentCount,
    absentCount: rows.length - presentCount,
    nullCount,
    validCount,
    invalidCount: presentCount - nullCount - validCount,
    distinctCount: distinct.size,
    types,
  }
}

/** Resolve a chave de cliente da linha pelo campo primário observado. */
export function rowClientKey(
  raw: Record<string, unknown> | null,
  field: ClientIdentityCandidateField
): string | null {
  const c = readCandidate(raw, field)
  return c.present ? normalizeClientKey(c.value) : null
}

/** Linhas em que dois candidatos válidos presentes discordam. */
export function countAliasConflicts(rows: IdentityRowInput[]): {
  rowsWithMultipleAliases: number
  aliasConflictCount: number
} {
  let rowsWithMultipleAliases = 0
  let aliasConflictCount = 0
  for (const row of rows) {
    const keys: string[] = []
    let presentAliases = 0
    for (const field of CLIENT_IDENTITY_CANDIDATE_FIELDS) {
      const c = readCandidate(row.raw, field)
      if (!c.present) continue
      presentAliases += 1
      const k = normalizeClientKey(c.value)
      if (k) keys.push(k)
    }
    if (presentAliases > 1) rowsWithMultipleAliases += 1
    if (new Set(keys).size > 1) aliasConflictCount += 1
  }
  return { rowsWithMultipleAliases, aliasConflictCount }
}

/** Mesmo contract_pk associado a mais de uma chave de cliente. */
export function countContractClientConflicts(
  pairs: Array<{ contractPk: string | null; clientKey: string | null }>
): { checked: boolean; repeatedContractCount: number; conflictCount: number } {
  const byContract = new Map<string, Set<string>>()
  const occurrences = new Map<string, number>()
  for (const p of pairs) {
    const contract = p.contractPk?.trim()
    if (!contract || !p.clientKey) continue
    occurrences.set(contract, (occurrences.get(contract) ?? 0) + 1)
    const set = byContract.get(contract) ?? new Set<string>()
    set.add(p.clientKey)
    byContract.set(contract, set)
  }
  let repeated = 0
  let conflicts = 0
  for (const [contract, set] of byContract) {
    if ((occurrences.get(contract) ?? 0) > 1) repeated += 1
    if (set.size > 1) conflicts += 1
  }
  return {
    checked: byContract.size > 0,
    repeatedContractCount: repeated,
    conflictCount: conflicts,
  }
}

export type ListIdentityAnalysis = {
  rowCount: number
  validInvoicePkCount: number
  contractPkPresentCount: number
  candidates: CandidateStats[]
  primaryField: ClientIdentityCandidateField | null
  primary: CandidateStats | null
  contractConsistencyChecked: boolean
  repeatedContractCount: number
  contractConflictCount: number
  rowsWithMultipleAliases: number
  aliasConflictCount: number
  /** Clientes (válidos) que aparecem em mais de uma fatura da página. */
  repeatedClientCount: number
  /** Clientes (válidos) associados a mais de um contract_pk. */
  clientsWithMultipleContracts: number
  proven: boolean
  anyCandidateObserved: boolean
}

export function analyzeListIdentity(rows: IdentityRowInput[]): ListIdentityAnalysis {
  const candidates = CLIENT_IDENTITY_CANDIDATE_FIELDS.map((f) =>
    computeCandidateStats(rows, f)
  )
  const primary = candidates.find((c) => c.presentCount > 0) ?? null
  const primaryField = primary?.field ?? null
  const pairs = rows.map((r) => ({
    contractPk: r.contractPk,
    clientKey: primaryField ? rowClientKey(r.raw, primaryField) : null,
  }))
  const contract = countContractClientConflicts(pairs)
  const alias = countAliasConflicts(rows)

  const clientInvoices = new Map<string, number>()
  const clientContracts = new Map<string, Set<string>>()
  for (const p of pairs) {
    if (!p.clientKey) continue
    clientInvoices.set(p.clientKey, (clientInvoices.get(p.clientKey) ?? 0) + 1)
    const c = p.contractPk?.trim()
    if (c) {
      const s = clientContracts.get(p.clientKey) ?? new Set<string>()
      s.add(c)
      clientContracts.set(p.clientKey, s)
    }
  }

  const typeKinds = primary ? Object.keys(primary.types).length : 0
  const proven = Boolean(
    primary &&
      rows.length > 0 &&
      primary.presentCount === rows.length &&
      primary.validCount === rows.length &&
      primary.invalidCount === 0 &&
      primary.nullCount === 0 &&
      typeKinds === 1 &&
      contract.conflictCount === 0 &&
      alias.aliasConflictCount === 0
  )

  return {
    rowCount: rows.length,
    validInvoicePkCount: rows.filter((r) => Boolean(r.invoicePk?.trim())).length,
    contractPkPresentCount: rows.filter((r) => Boolean(r.contractPk?.trim())).length,
    candidates,
    primaryField,
    primary,
    contractConsistencyChecked: contract.checked,
    repeatedContractCount: contract.repeatedContractCount,
    contractConflictCount: contract.conflictCount,
    rowsWithMultipleAliases: alias.rowsWithMultipleAliases,
    aliasConflictCount: alias.aliasConflictCount,
    repeatedClientCount: [...clientInvoices.values()].filter((n) => n > 1).length,
    clientsWithMultipleContracts: [...clientContracts.values()].filter(
      (s) => s.size > 1
    ).length,
    proven,
    anyCandidateObserved: candidates.some((c) => c.presentCount > 0),
  }
}

export type DetailObservation = {
  ok: boolean
  httpStatus: number | null
  timedOut: boolean
  durationMs: number
  /** raw da linha de detalhe (uso interno; nunca serializado). */
  raw: Record<string, unknown> | null
  /** Contexto interno da linha de list correspondente. */
  listRaw: Record<string, unknown> | null
  contractPk: string | null
}

export type DetailIdentityAnalysis = {
  requestedCount: number
  successfulCount: number
  timedOutCount: number
  candidateField: ClientIdentityCandidateField | null
  presentCount: number
  validCount: number
  types: Partial<Record<ValueTypeName, number>>
  identityAgreementCount: number
  identityConflictCount: number
  contractConflictCount: number
  aliasConflictCount: number
  proven: boolean
  anyCandidateObserved: boolean
}

export function analyzeDetailIdentity(
  observations: DetailObservation[],
  listPrimaryField: ClientIdentityCandidateField | null
): DetailIdentityAnalysis {
  const okObs = observations.filter((o) => o.ok && o.raw)
  const rows: IdentityRowInput[] = okObs.map((o) => ({
    invoicePk: null,
    contractPk: o.contractPk,
    raw: o.raw,
  }))
  const stats = CLIENT_IDENTITY_CANDIDATE_FIELDS.map((f) =>
    computeCandidateStats(rows, f)
  )
  const primary = stats.find((s) => s.presentCount > 0) ?? null
  const field = primary?.field ?? null
  let agreement = 0
  let conflict = 0
  const pairs: Array<{ contractPk: string | null; clientKey: string | null }> = []
  for (const o of okObs) {
    const detailKey = field ? rowClientKey(o.raw, field) : null
    pairs.push({ contractPk: o.contractPk, clientKey: detailKey })
    const listKey = listPrimaryField ? rowClientKey(o.listRaw, listPrimaryField) : null
    if (detailKey && listKey) {
      if (detailKey === listKey) agreement += 1
      else conflict += 1
    }
  }
  const contract = countContractClientConflicts(pairs)
  const alias = countAliasConflicts(rows)
  const proven = Boolean(
    primary &&
      observations.length > 0 &&
      okObs.length === observations.length &&
      primary.presentCount === okObs.length &&
      primary.validCount === okObs.length &&
      Object.keys(primary.types).length === 1 &&
      conflict === 0 &&
      contract.conflictCount === 0 &&
      alias.aliasConflictCount === 0
  )
  return {
    requestedCount: observations.length,
    successfulCount: okObs.length,
    timedOutCount: observations.filter((o) => o.timedOut).length,
    candidateField: field,
    presentCount: primary?.presentCount ?? 0,
    validCount: primary?.validCount ?? 0,
    types: primary?.types ?? {},
    identityAgreementCount: agreement,
    identityConflictCount: conflict,
    contractConflictCount: contract.conflictCount,
    aliasConflictCount: alias.aliasConflictCount,
    proven,
    anyCandidateObserved: stats.some((s) => s.presentCount > 0),
  }
}

export function emptyDetailAnalysis(): DetailIdentityAnalysis {
  return {
    requestedCount: 0,
    successfulCount: 0,
    timedOutCount: 0,
    candidateField: null,
    presentCount: 0,
    validCount: 0,
    types: {},
    identityAgreementCount: 0,
    identityConflictCount: 0,
    contractConflictCount: 0,
    aliasConflictCount: 0,
    proven: false,
    anyCandidateObserved: false,
  }
}

export function classifyClientIdentity(input: {
  list: ListIdentityAnalysis
  detail: DetailIdentityAnalysis
  detailSkippedForBudget: boolean
  detailTimedOut: boolean
  detailFailed: boolean
}): ClientIdentityClassification {
  if (input.list.proven) return "CLIENT_ID_PROVEN_IN_LIST"
  if (input.detail.proven) return "CLIENT_ID_PROVEN_IN_DETAIL"
  if (input.detailSkippedForBudget || input.detailTimedOut) {
    return "INCONCLUSIVE_TIMEOUT_OR_BUDGET"
  }
  if (input.list.anyCandidateObserved || input.detail.anyCandidateObserved) {
    return "CLIENT_ID_PARTIALLY_OBSERVED"
  }
  if (input.detailFailed) return "INVALID_RESPONSE"
  return "CLIENT_ID_NOT_PRESENT"
}

export function clampClientIdentityTimeoutMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return CLIENT_IDENTITY_TIMEOUT_DEFAULT_MS
  return Math.min(
    CLIENT_IDENTITY_TIMEOUT_MAX_MS,
    Math.max(CLIENT_IDENTITY_TIMEOUT_MIN_MS, Math.floor(n))
  )
}

/** Escolhe até dois índices de linha com invoice_pk válido (nunca exposto). */
export function selectDetailRowIndexes(rows: IdentityRowInput[]): number[] {
  const seen = new Set<string>()
  const out: number[] = []
  rows.forEach((r, i) => {
    const pk = r.invoicePk?.trim()
    if (!pk || !/^\d+$/.test(pk) || seen.has(pk)) return
    if (out.length >= CLIENT_IDENTITY_MAX_DETAIL_REQUESTS) return
    seen.add(pk)
    out.push(i)
  })
  return out
}

export type ClientIdentityHealthResult = {
  ok: boolean
  mode: typeof CLIENT_IDENTITY_HEALTH_MODE
  requestId: string
  startedAt: string
  finishedAt: string
  attempts: 1
  timeoutMs: number
  errorClass: string
  referenceDate: string | null
  minimumDaysOverdue: number | null
  query: {
    page: 1
    start: 0
    limit: number
    sort: string
    dir: string
    cursor: "absent"
  }
  timings: {
    totalDurationMs: number
    loginDurationMs: number | "NOT_OBSERVED"
    listDurationMs: number | "NOT_OBSERVED"
    detailDurationMs: number | "NOT_OBSERVED"
  }
  list: {
    httpStatus: number | null
    rowCount: number | null
    shapeValid: boolean
    validInvoicePkCount: number | null
    contractPkPresentCount: number | null
  }
  identity: {
    candidateField: ClientIdentityCandidateField | null
    source: "invoice_list" | "invoice_info" | "none"
    presentCount: number
    nullCount: number
    validCount: number
    invalidCount: number
    distinctCount: number
    types: Partial<Record<ValueTypeName, number>>
    contractConsistencyChecked: boolean
    repeatedContractCount: number
    contractConflictCount: number
    rowsWithMultipleAliases: number
    aliasConflictCount: number
    repeatedClientCount: number
    clientsWithMultipleContracts: number
    candidates: Array<Omit<CandidateStats, never>>
  }
  detail: {
    requestedCount: number
    successfulCount: number
    timedOutCount: number
    skippedForBudget: boolean
    candidateField: ClientIdentityCandidateField | null
    presentCount: number
    validCount: number
    types: Partial<Record<ValueTypeName, number>>
    identityAgreementCount: number
    identityConflictCount: number
    contractConflictCount: number
    aliasConflictCount: number
    httpStatuses: number[]
  }
  classification: ClientIdentityClassification
}

export function emptyListAnalysis(): ListIdentityAnalysis {
  return analyzeListIdentity([])
}

export function buildIdentitySection(
  list: ListIdentityAnalysis,
  detail: DetailIdentityAnalysis,
  classification: ClientIdentityClassification
): ClientIdentityHealthResult["identity"] {
  const p = list.primary
  const source: ClientIdentityHealthResult["identity"]["source"] =
    classification === "CLIENT_ID_PROVEN_IN_DETAIL"
      ? "invoice_info"
      : p
        ? "invoice_list"
        : detail.candidateField
          ? "invoice_info"
          : "none"
  return {
    candidateField: list.primaryField ?? detail.candidateField,
    source,
    presentCount: p?.presentCount ?? 0,
    nullCount: p?.nullCount ?? 0,
    validCount: p?.validCount ?? 0,
    invalidCount: p?.invalidCount ?? 0,
    distinctCount: p?.distinctCount ?? 0,
    types: p?.types ?? {},
    contractConsistencyChecked: list.contractConsistencyChecked,
    repeatedContractCount: list.repeatedContractCount,
    contractConflictCount: list.contractConflictCount,
    rowsWithMultipleAliases: list.rowsWithMultipleAliases,
    aliasConflictCount: list.aliasConflictCount,
    repeatedClientCount: list.repeatedClientCount,
    clientsWithMultipleContracts: list.clientsWithMultipleContracts,
    candidates: list.candidates.map((c) => ({ ...c, types: { ...c.types } })),
  }
}
