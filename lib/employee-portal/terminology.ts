/**
 * 3.1F-J2 — Terminologia CONTEXTUAL da área do funcionário/remuneração.
 *
 * Não altera o StatusBadge global (components/ui/status-badge.tsx), que continua
 * atendendo o Indique e Ganhe com "Paga"/"Disponível". Estes mapas valem SOMENTE
 * nas telas /funcionario/* e /admin/remuneracao/*.
 *
 * Proibido nesta área: "Saldo disponível", "Solicitar saque", "Pix", "Carteira".
 */

export type BadgeTone = "neutral" | "info" | "warning" | "success" | "danger" | "primary"

export const ENTITLEMENT_STATUS_LABEL: Record<string, string> = {
  // 3.1F-J3: enquanto não houver regra de comissão ativa (Entrega B), nenhuma comissão é calculada.
  none: "Aguardando regra financeira",
  pending_evidence: "Aguardando evidência",
  // Contrato J2: accrued = valor apurado na competência, ainda não revisado.
  accrued: "Em apuração",
  approved: "Revisada",
  included_in_payroll: "Incluída na competência",
  paid: "Pagamento registrado",
  reversed: "Estornada",
  rejected: "Não elegível",
}

export const ENTITLEMENT_STATUS_TONE: Record<string, BadgeTone> = {
  none: "neutral",
  pending_evidence: "warning",
  accrued: "info",
  approved: "primary",
  included_in_payroll: "primary",
  paid: "success",
  reversed: "danger",
  rejected: "neutral",
}

export const COMPETENCE_STATUS_LABEL: Record<string, string> = {
  draft: "Em preparação",
  calculated: "Calculada",
  reviewed: "Revisada",
  under_review: "Em revisão",
  closed: "Fechada",
  paid: "Pagamento registrado",
  reopened: "Reaberta",
}

export const COMPETENCE_STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  calculated: "info",
  reviewed: "primary",
  under_review: "primary",
  closed: "success",
  paid: "success",
  reopened: "warning",
}

export const PIPELINE_STAGE_LABEL: Record<string, string> = {
  novo: "Interessado",
  tentativa_contato: "Tentativa de contato",
  contato_realizado: "Contato realizado",
  negociacao: "Negociação",
  agendado: "Agendado",
  instalacao: "Instalação agendada",
  ativado: "Ativado",
  perdido: "Perdido",
}

/** Status comercial da oportunidade no contexto do funcionário (sem linguagem de recompensa). */
export const OPPORTUNITY_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  em_atendimento: "Em atendimento",
  em_negociacao: "Em negociação",
  aprovada: "Aprovada",
  recusada: "Recusada",
  paga: "Concluída",
}

export const ATTRIBUTION_ROLE_LABEL: Record<string, string> = {
  technician_originator: "Técnico originador",
  external_sales_originator: "Vendedor externo",
  internal_sales_responsible: "Responsável interno",
}

export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  vacation: "Férias",
  away: "Afastado",
}

export const COMPONENT_LABEL: Record<string, string> = {
  commission: "Comissão",
  salary: "Salário",
  meal: "Vale-refeição",
  transport: "Transporte",
  fuel: "Combustível",
  otherEarnings: "Outros ganhos",
  discounts: "Descontos",
}

export const TOTAL_KIND_LABEL: Record<string, string> = {
  expected: "Total previsto",
  closed: "Total fechado",
}

export const BENEFIT_METHOD_LABEL: Record<string, string> = {
  per_worked_day: "por dia trabalhado",
  monthly_fixed: "mensal fixo",
}

/** Expressões que nunca podem aparecer na área do funcionário/remuneração. */
export const FORBIDDEN_EMPLOYEE_TERMS = [
  "Saldo disponível",
  "Solicitar saque",
  "Sacar",
  "Carteira",
  "Chave Pix",
] as const

export function labelFor(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—"
  return map[key] ?? "—"
}
