import { getSupabaseClient } from "@/lib/supabase/client"

export const PAYMENT_RECEIPTS_BUCKET = "payment-receipts"

const PREFIX = "pix-withdrawals"
const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
])

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

export type UploadPixWithdrawalReceiptResult =
  | { ok: true; receiptPath: string; uploadPath: string }
  | { ok: false; message: string }

function inferMimeFromFileName(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (!ext) return null
  return EXT_TO_MIME[ext] ?? null
}

/** MIME usado na validação do bucket e no header Content-Type do upload. */
export function resolveReceiptContentType(file: File): string {
  const raw = file.type.trim().toLowerCase()
  if (raw === "image/jpg") return "image/jpeg"
  if (ALLOWED_MIME.has(raw)) return raw
  if (raw === "" || raw === "application/octet-stream") {
    const inferred = inferMimeFromFileName(file)
    if (inferred) return inferred
  }
  return raw
}

export function validateReceiptFileBeforeUpload(file: File | null | undefined): {
  ok: true
  contentType: string
  ext: string
} | { ok: false; message: string } {
  if (!file || !(file instanceof File)) {
    return { ok: false, message: "Nenhum arquivo selecionado." }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "Arquivo acima do limite de 10 MB." }
  }
  const contentType = resolveReceiptContentType(file)
  if (!ALLOWED_MIME.has(contentType)) {
    return {
      ok: false,
      message: "Formato não permitido. Use PDF, PNG, JPG ou WEBP.",
    }
  }
  const ext = extensionFromMime(contentType)
  if (!ext) {
    return { ok: false, message: "Não foi possível determinar a extensão do arquivo." }
  }
  return { ok: true, contentType, ext }
}

function extensionFromMime(mime: string): string | undefined {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }
  return map[mime]
}

function sanitizePaymentIdForPath(paymentId: string): string {
  return paymentId.replace(/[^a-zA-Z0-9-]/g, "")
}

function formatStorageError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return String(err ?? "Erro desconhecido no Storage.")
  }
  const e = err as {
    message?: string
    name?: string
    statusCode?: string | number
    error?: string
  }
  const parts = [
    e.message,
    e.error && `code: ${e.error}`,
    e.statusCode != null && `HTTP ${e.statusCode}`,
    e.name && e.name !== "StorageApiError" ? e.name : null,
  ].filter(Boolean)
  if (parts.length) return parts.join(" · ")
  try {
    return JSON.stringify(err)
  } catch {
    return "Falha no upload (Storage)."
  }
}

/**
 * Envia comprovante para `payment-receipts` / `pix-withdrawals/`.
 * Retorna `receiptPath` no formato `payment-receipts/pix-withdrawals/...` para gravar em `payments.receipt_url`.
 */
export async function uploadPixWithdrawalReceipt(
  paymentId: string,
  file: File
): Promise<UploadPixWithdrawalReceiptResult> {
  const validated = validateReceiptFileBeforeUpload(file)
  if (!validated.ok) {
    return { ok: false, message: validated.message }
  }
  const { contentType, ext } = validated

  const safeId = sanitizePaymentIdForPath(paymentId)
  if (!safeId) {
    return { ok: false, message: "ID do pagamento inválido para o caminho do arquivo." }
  }

  const uploadPath = `${PREFIX}/${safeId}-${Date.now()}.${ext}`
  const receiptPath = `${PAYMENT_RECEIPTS_BUCKET}/${uploadPath}`

  const fileName = file.name
  const fileType = file.type
  const fileSize = file.size

  const supabase = getSupabaseClient()
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .upload(uploadPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType,
    })

  // Logs de diagnóstico (requisito operacional do fluxo de comprovante).
  console.log("uploadPath", uploadPath)
  console.log("fileName", fileName)
  console.log("fileType", fileType)
  console.log("fileSize", fileSize)
  console.log("uploadError", uploadError ?? null)
  console.log("uploadData", uploadData ?? null)
  console.log("contentType (enviado ao Storage)", contentType)

  if (uploadError) {
    return {
      ok: false,
      message: formatStorageError(uploadError),
    }
  }

  return { ok: true, receiptPath, uploadPath }
}
