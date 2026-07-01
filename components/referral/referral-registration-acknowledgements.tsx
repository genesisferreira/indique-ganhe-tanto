import type { Indicacao } from "@/types/referral"

type ReferralRegistrationAcknowledgementsProps = {
  indicacao: Indicacao
  variant?: "card" | "compact"
}

function formatAckDate(value?: Date): string | null {
  if (!value) return null
  return value.toLocaleString("pt-BR")
}

function yesNo(value?: boolean): string {
  return value ? "Sim" : "Não"
}

export function ReferralRegistrationAcknowledgements({
  indicacao,
  variant = "card",
}: ReferralRegistrationAcknowledgementsProps) {
  const taxasDate = formatAckDate(indicacao.cienteTaxasInstalacaoEm)
  const contratoDate = formatAckDate(indicacao.cienteDiferencaContratacaoEm)

  if (variant === "compact") {
    return (
      <div className="space-y-2 text-sm border-t border-border pt-3 mt-3">
        <p className="font-medium text-foreground">Confirmações do cadastro</p>
        <p className="text-muted-foreground">
          Ciente sobre possíveis taxas:{" "}
          <span className="text-foreground">{yesNo(indicacao.cienteTaxasInstalacao)}</span>
          {taxasDate ? ` (${taxasDate})` : ""}
        </p>
        <p className="text-muted-foreground">
          Ciente sobre Tanto Livre/Vantagens:{" "}
          <span className="text-foreground">
            {yesNo(indicacao.cienteDiferencaContratacao)}
          </span>
          {contratoDate ? ` (${contratoDate})` : ""}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-3">
        Confirmações do cadastro
      </h2>
      <ul className="text-sm space-y-2">
        <li>
          <span className="text-muted-foreground">
            Ciente sobre possíveis taxas:{" "}
          </span>
          <span className="font-medium text-foreground">
            {yesNo(indicacao.cienteTaxasInstalacao)}
          </span>
          {taxasDate ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Confirmado em {taxasDate}
            </p>
          ) : null}
        </li>
        <li>
          <span className="text-muted-foreground">
            Ciente sobre Tanto Livre/Vantagens:{" "}
          </span>
          <span className="font-medium text-foreground">
            {yesNo(indicacao.cienteDiferencaContratacao)}
          </span>
          {contratoDate ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Confirmado em {contratoDate}
            </p>
          ) : null}
        </li>
      </ul>
    </div>
  )
}
