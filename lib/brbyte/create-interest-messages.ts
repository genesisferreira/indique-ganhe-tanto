export const BRBYTE_UNCONFIRMED_INTEREST_MESSAGE =
  "Interessado pode ter sido criado no Controllr, mas o CRM não conseguiu confirmar o ID. Verifique manualmente antes de tentar novamente."

export function isUnconfirmedBrbyteCreateError(
  message: string | null | undefined
): boolean {
  return Boolean(message?.includes("não conseguiu confirmar o ID"))
}
