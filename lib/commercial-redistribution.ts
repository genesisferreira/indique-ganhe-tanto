/** Redistribuição automática de leads por SLA. */

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

export function devLogCommercialRedistribution(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-redistribution]", ...args)
}

export function devLogCommercialRedistributionSuccess(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-redistribution:success]", ...args)
}

export function devLogCommercialRedistributionSkip(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-redistribution:skip]", ...args)
}

export function devLogCommercialRedistributionError(...args: unknown[]): void {
  if (!isDev()) return
  console.error("[commercial-redistribution:error]", ...args)
}
