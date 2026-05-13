/**
 * Dados mock só quando o provider está explicitamente em `mock`.
 */
export function isDataProviderMock(): boolean {
  return (
    process.env.NEXT_PUBLIC_DATA_PROVIDER === "mock" ||
    process.env.DATA_PROVIDER === "mock"
  )
}
