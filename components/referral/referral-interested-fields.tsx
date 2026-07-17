import type { ReactNode } from "react"
import type { Indicacao } from "@/types/referral"
import { formatControllrBirthDate } from "@/lib/brbyte/normalize-controllr-text"
import {
  Calendar,
  CreditCard,
  FileText,
  Hash,
  Home,
  MapPin,
} from "lucide-react"

function formatCpf(value: string): string {
  const d = value.replace(/\D/g, "")
  if (d.length !== 11) return value
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function formatCep(value: string): string {
  const d = value.replace(/\D/g, "")
  if (d.length !== 8) return value
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

function hasComplementaryData(indicacao: Indicacao): boolean {
  return Boolean(
    indicacao.cpfIndicado ||
      indicacao.rgIndicado ||
      indicacao.observacaoIndicado ||
      indicacao.referredBirthDate ||
      indicacao.preferredInvoiceDueDay != null
  )
}

function hasInstallationAddress(indicacao: Indicacao): boolean {
  return Boolean(
    indicacao.cepInstalacao ||
      indicacao.estadoInstalacao ||
      indicacao.cidadeInstalacao ||
      indicacao.bairroInstalacao ||
      indicacao.enderecoInstalacao ||
      indicacao.numeroInstalacao ||
      indicacao.complementoInstalacao
  )
}

function hasErpInteressadoData(indicacao: Indicacao): boolean {
  return Boolean(
    indicacao.brbyteIdInteressado ||
      indicacao.brbyteInteressadoStatus ||
      indicacao.brbyteInteressadoCreatedAt ||
      indicacao.brbyteInteressadoLastSyncAt
  )
}

type FieldRowProps = {
  icon: ReactNode
  label: string
  value: string
}

function FieldRow({ icon, label, value }: FieldRowProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

type ReferralInterestedFieldsProps = {
  indicacao: Indicacao
  /** Estilo admin: linhas compactas com ícones inline */
  variant?: "card" | "compact"
}

export function ReferralInterestedFields({
  indicacao,
  variant = "card",
}: ReferralInterestedFieldsProps) {
  const showComplementary = hasComplementaryData(indicacao)
  const showAddress = hasInstallationAddress(indicacao)
  const showErp = hasErpInteressadoData(indicacao)
  const birthLabel =
    formatControllrBirthDate(indicacao.referredBirthDate) ?? null
  const dueDayLabel =
    indicacao.preferredInvoiceDueDay != null
      ? String(indicacao.preferredInvoiceDueDay).padStart(2, "0")
      : null

  if (!showComplementary && !showAddress && !showErp) {
    return null
  }

  if (variant === "compact") {
    return (
      <div className="space-y-4">
        {showComplementary ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">Dados complementares</p>
            {indicacao.cpfIndicado ? (
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span>CPF: {formatCpf(indicacao.cpfIndicado)}</span>
              </div>
            ) : null}
            {indicacao.rgIndicado ? (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>RG: {indicacao.rgIndicado}</span>
              </div>
            ) : null}
            {birthLabel ? (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>Nascimento: {birthLabel}</span>
              </div>
            ) : null}
            {dueDayLabel ? (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>Vencimento: dia {dueDayLabel}</span>
              </div>
            ) : null}
            {indicacao.observacaoIndicado ? (
              <p className="text-muted-foreground whitespace-pre-wrap">
                {indicacao.observacaoIndicado}
              </p>
            ) : null}
          </div>
        ) : null}
        {showAddress ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">Endereço para instalação</p>
            {indicacao.cepInstalacao ? (
              <p className="text-muted-foreground">
                CEP: {formatCep(indicacao.cepInstalacao)}
              </p>
            ) : null}
            {indicacao.estadoInstalacao || indicacao.cidadeInstalacao ? (
              <p className="text-muted-foreground">
                {[indicacao.cidadeInstalacao, indicacao.estadoInstalacao]
                  .filter(Boolean)
                  .join(" — ")}
              </p>
            ) : null}
            {indicacao.bairroInstalacao ? (
              <p className="text-muted-foreground">Bairro: {indicacao.bairroInstalacao}</p>
            ) : null}
            {indicacao.enderecoInstalacao ? (
              <p className="text-muted-foreground">
                {indicacao.enderecoInstalacao}
                {indicacao.numeroInstalacao ? `, ${indicacao.numeroInstalacao}` : ""}
                {indicacao.complementoInstalacao
                  ? ` — ${indicacao.complementoInstalacao}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {showComplementary ? (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Dados complementares
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {indicacao.cpfIndicado ? (
              <FieldRow
                icon={<CreditCard className="w-5 h-5 text-primary" />}
                label="CPF"
                value={formatCpf(indicacao.cpfIndicado)}
              />
            ) : null}
            {indicacao.rgIndicado ? (
              <FieldRow
                icon={<FileText className="w-5 h-5 text-primary" />}
                label="RG"
                value={indicacao.rgIndicado}
              />
            ) : null}
            {birthLabel ? (
              <FieldRow
                icon={<Calendar className="w-5 h-5 text-primary" />}
                label="Data de nascimento"
                value={birthLabel}
              />
            ) : null}
            {dueDayLabel ? (
              <FieldRow
                icon={<Calendar className="w-5 h-5 text-primary" />}
                label="Dia de vencimento"
                value={dueDayLabel}
              />
            ) : null}
          </div>
          {indicacao.observacaoIndicado ? (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Observação</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {indicacao.observacaoIndicado}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {showAddress ? (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Endereço para instalação
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {indicacao.cepInstalacao ? (
              <FieldRow
                icon={<MapPin className="w-5 h-5 text-primary" />}
                label="CEP"
                value={formatCep(indicacao.cepInstalacao)}
              />
            ) : null}
            {indicacao.estadoInstalacao ? (
              <FieldRow
                icon={<MapPin className="w-5 h-5 text-primary" />}
                label="Estado"
                value={indicacao.estadoInstalacao}
              />
            ) : null}
            {indicacao.cidadeInstalacao ? (
              <FieldRow
                icon={<MapPin className="w-5 h-5 text-primary" />}
                label="Cidade"
                value={indicacao.cidadeInstalacao}
              />
            ) : null}
            {indicacao.bairroInstalacao ? (
              <FieldRow
                icon={<Home className="w-5 h-5 text-primary" />}
                label="Bairro"
                value={indicacao.bairroInstalacao}
              />
            ) : null}
            {indicacao.enderecoInstalacao ? (
              <FieldRow
                icon={<Home className="w-5 h-5 text-primary" />}
                label="Endereço"
                value={indicacao.enderecoInstalacao}
              />
            ) : null}
            {indicacao.numeroInstalacao ? (
              <FieldRow
                icon={<Hash className="w-5 h-5 text-primary" />}
                label="Número"
                value={indicacao.numeroInstalacao}
              />
            ) : null}
            {indicacao.complementoInstalacao ? (
              <FieldRow
                icon={<Home className="w-5 h-5 text-primary" />}
                label="Complemento"
                value={indicacao.complementoInstalacao}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
