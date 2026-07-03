/** Tipos BRByte / Controllr — uso server-only (cron, matching). */

export type BrbyteApiEnvelope<T> = {
  data?: T
  error?: boolean
  message?: string | null
}

export type BrbyteTerceroContact = {
  idTercero?: number | null
  celular?: string | null
  telefono?: string | null
  email?: string | null
  primerNombre?: string | null
  primerApellido?: string | null
}

export type BrbyteTerceroDto = {
  idTercero?: number | null
  numeroIdentificacion?: string | null
  nombreCompleto?: string | null
  email?: string | null
  telefonoContacto?: string | null
  celular?: string | null
  terceroContacto?: BrbyteTerceroContact | null
}

export type BrbyteClienteDto = {
  idCliente?: number | null
  idTercero?: number | null
  nombreCliente?: string | null
  codigoCliente?: string | null
  noContrato?: string | null
}

export type BrbyteContratoDto = {
  idContrato?: number | null
  idCliente?: number | null
  noContrato?: string | null
  numeroContrato?: string | null
  nomenclaturaEstadoContrato?: string | null
  nombreCliente?: string | null
}

/** Placeholder — endpoint oficial de cobrança ISP (ainda não integrado). */
export type BrbyteCobrancaPlaceholder = {
  idCobranca?: string | number | null
  idContrato?: string | number | null
  periodo?: string | null
  valor?: number | null
  saldo?: number | null
  nomenclaturaEstado?: string | null
  dataPagamento?: string | null
  pago?: boolean | null
}

export type BrbyteMatchMethod = "document" | "phone" | "email" | "none"

export type BrbyteCustomerMatch = {
  matched: boolean
  method: BrbyteMatchMethod
  idTercero: string | null
  idCliente: string | null
  idContrato: string | null
  noContrato: string | null
  confidence: "high" | "medium" | "low"
  raw?: Record<string, unknown>
}

export type ReferralBrbyteMatchInput = {
  referralId: string
  referredName: string
  referredPhone: string
  referredEmail?: string | null
  referredDocument?: string | null
  brbyteIdTercero?: string | null
  brbyteIdCliente?: string | null
  brbyteIdContrato?: string | null
}

export type BrbyteSyncRunStatus =
  | "running"
  | "ok"
  | "partial"
  | "error"
  | "skipped"

export type BrbyteSyncRunPhase =
  | "login"
  | "create_interest"
  | "find_interest"
  | "find_client"
  | "find_contract"
  | "find_invoice"
  | "release_reward"

export type BrbyteSyncRunRow = {
  id: string
  started_at: string
  finished_at: string | null
  status: BrbyteSyncRunStatus
  phase?: BrbyteSyncRunPhase | string | null
  configured: boolean
  api_reachable: boolean | null
  fetched: number
  processed: number
  matched: number
  snapshots_upserted: number
  marked_paid: number
  skipped_records: number
  errors_count: number
  duration_ms: number | null
  error_summary: Record<string, unknown> | null
  meta: Record<string, unknown>
}

export type BrbytePaymentSnapshotInsert = {
  referral_id: string
  sync_run_id?: string | null
  brbyte_id_contrato?: string | null
  periodo?: string | null
  external_reference?: string | null
  valor?: number | null
  saldo?: number | null
  nomenclatura_estado?: string | null
  paid_detected: boolean
  paid_at?: string | null
  source_endpoint: string
  raw_payload: Record<string, unknown>
}

/** Endpoints documentados — placeholders até URL/cobrança oficial do tenant. */
export const BRBYTE_API_PATHS = {
  ping: "/api/contratos/datosBasicos",
  terceroByDocument: "/api/tercero/obtenerPorTipoNumeroIdentificacion",
  clienteByTercero: "/api/cliente/obtenerInformacion",
  contratosByCliente: "/api/contratos/cliente",
  /** Reservado: cobrança/fatura ISP (não usar até confirmação BRByte). */
  cobrancaList: "/api/cobranca/cliente",
  /** Área administrativa — criação manual de Interessado (sem captcha do Hotsite). */
  createClientInterest: "/controllrctl/client_interest/create",
  /** Listagem administrativa de Interessados (fallback pós-criação). */
  listClientInterest: "/controllrctl/client_interest/list",
} as const

export type BrbyteCreateInterestPayload = {
  lead_pk: string
  interest_status: string
  interest_type: string
  interest_name: string
  interest_lastname: string
  interest_doc1: string
  interest_doc2: string
  interest_phone_number: string
  interest_email_addr: string
  interest_addr_zipcode: string
  interest_addr_state: string
  interest_addr_city: string
  interest_addr_neighborhood: string
  interest_addr_address: string
  interest_addr_number: string
  interest_addr_obs: string
  plan_pk: string
  interest_obs: string
}

export type BrbyteCreateInterestResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  referralId: string
  syncRunId: string | null
  brbyteIdInteressado: string | null
  brbyteInteressadoStatus: string | null
  message?: string
  durationMs: number
}
