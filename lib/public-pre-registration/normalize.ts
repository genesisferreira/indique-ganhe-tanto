/**
 * Compatibilidade do pré-cadastro público com o helper compartilhado do Controllr.
 * Campos técnicos (e-mail, documentos, UTMs, URLs e códigos) não devem usar este helper.
 */
export {
  CONTROLLR_INVOICE_DUE_DAYS as PUBLIC_PRE_REGISTRATION_DUE_DAYS,
  formatControllrBirthDate as formatPublicPreRegistrationBirthDate,
  isValidControllrInvoiceDueDay as isValidPublicPreRegistrationDueDay,
  normalizeControllrErpTextFields as normalizePublicPreRegistrationErpTextFields,
  normalizeControllrText as normalizePublicPreRegistrationText,
  validateControllrBirthDate as validatePublicPreRegistrationBirthDate,
  type ControllrErpTextFields as PublicPreRegistrationErpTextFields,
} from "@/lib/brbyte/normalize-controllr-text"
