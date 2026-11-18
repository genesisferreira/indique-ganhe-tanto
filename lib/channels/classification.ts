export type ChannelEvidence = {
  originKind: string | null
  source: string | null
  erpLeadSource: string | null
  indicatorProfileId: string | null
  partnerKey: string | null
  employeeKey: string | null
  campaign: string | null
  employeeRole: string | null
}

export type ChannelClassification = {
  originGroup: "direct" | "referral" | "unclassified"
  acquisitionKind: string
}

const PRE_REGISTRATION_ERP = "Pr\u00e9-cadastro Web"
const NEUTRAL_ERP = "Pr\u00e9-cadastro Rede Neutra"

function filled(value: string | null): boolean {
  return Boolean(value && value.trim())
}

export function classifyChannel(evidence: ChannelEvidence): ChannelClassification {
  const partner = evidence.originKind === "partner_merchant" || filled(evidence.partnerKey)
  const employee = evidence.originKind === "employee" || filled(evidence.employeeKey)
  const indicator = Boolean(evidence.indicatorProfileId) && (
    evidence.originKind === "indicator"
    || evidence.originKind === "assisted_indicator"
    || evidence.erpLeadSource === "Indique e Ganhe"
    || evidence.source === "referral_share_link"
    || evidence.source === "commercial_assisted_referral"
  )
  const direct = !evidence.indicatorProfileId
    && !filled(evidence.partnerKey)
    && !filled(evidence.employeeKey)
    && evidence.originKind !== "partner_merchant"
    && evidence.originKind !== "employee"
    && (
      (evidence.source === "public_pre_registration" && evidence.erpLeadSource === PRE_REGISTRATION_ERP)
      || evidence.originKind === "web_preregistration"
      || evidence.source === "neutral_network_pre_registration"
      || evidence.erpLeadSource === NEUTRAL_ERP
      || evidence.originKind === "neutral_network"
    )
  const signals = Number(partner) + Number(employee) + Number(indicator) + Number(direct)
  if (signals !== 1) return { originGroup: "unclassified", acquisitionKind: "unclassified_legacy" }
  if (partner) return { originGroup: "referral", acquisitionKind: "partner_merchant" }
  if (employee) {
    if (evidence.employeeRole === "technician_originator") return { originGroup: "referral", acquisitionKind: "employee_technician" }
    if (evidence.employeeRole === "external_sales_originator") return { originGroup: "referral", acquisitionKind: "employee_external_sales" }
    return { originGroup: "unclassified", acquisitionKind: "unclassified_legacy" }
  }
  if (indicator) return { originGroup: "referral", acquisitionKind: "indicator" }
  if (filled(evidence.campaign)) return { originGroup: "direct", acquisitionKind: "direct_campaign" }
  if (evidence.source === "public_pre_registration" || evidence.originKind === "web_preregistration" || evidence.erpLeadSource === PRE_REGISTRATION_ERP) {
    return { originGroup: "direct", acquisitionKind: "direct_preregistration" }
  }
  return { originGroup: "direct", acquisitionKind: "direct_other" }
}

export function channelRewardAllowed(channel: ChannelClassification): boolean {
  return channel.originGroup === "referral" && channel.acquisitionKind === "indicator"
}

export const CHANNEL_LABELS: Record<string, string> = {
  direct_preregistration: "Pré-cadastro",
  direct_website: "Site",
  direct_campaign: "Campanha",
  direct_admin: "Cadastro interno",
  direct_other: "Outra captação direta",
  indicator: "Indique e Ganhe",
  partner_merchant: "Comércio parceiro",
  employee_technician: "Técnico",
  employee_external_sales: "Vendedor externo",
  unclassified_legacy: "Origem não classificada",
}

export const CHANNEL_BADGES: Record<string, string> = {
  direct_preregistration: "Captação direta",
  direct_website: "Captação direta",
  direct_campaign: "Captação direta",
  direct_admin: "Captação direta",
  direct_other: "Captação direta",
  indicator: "Indique e Ganhe",
  partner_merchant: "Comércio parceiro",
  employee_technician: "Técnico",
  employee_external_sales: "Vendedor externo",
  unclassified_legacy: "Origem não classificada",
}

export function channelLabel(kind: string | null | undefined): string {
  if (!kind) return "Origem não classificada"
  return CHANNEL_LABELS[kind] ?? "Origem não classificada"
}

export function channelBadge(kind: string | null | undefined): string {
  if (!kind) return "Origem não classificada"
  return CHANNEL_BADGES[kind] ?? "Origem não classificada"
}

export const LIST_CHANNELS = ["direct", "referral", "indicator", "partner_merchant", "employee_technician", "employee_external_sales", "unclassified"] as const

export function notificationTitle(kind: string | null | undefined): string {
  if (kind === "partner_merchant") return "Nova indicação de comércio parceiro"
  if (kind === "employee_technician" || kind === "employee_external_sales") return "Nova indicação de funcionário"
  if (kind && kind.startsWith("direct_")) return "Nova captação direta"
  if (kind === "indicator") return "Nova indicação"
  return "Nova oportunidade"
}
