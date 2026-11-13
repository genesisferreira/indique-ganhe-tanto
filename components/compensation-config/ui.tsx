import { AlertTriangle, Info, Lock } from "lucide-react"
import { ACTIVATE_DISABLED_REASON, DRAFT_BANNERS, VERSION_STATUS_LABEL, type VersionStatus } from "@/lib/compensation-config/contract"
import { cn } from "@/lib/utils"

/** 3.1F-J4: avisos fixos — tudo é rascunho, nada ativo, nenhuma comissão calculada. */
export function DraftBanners() {
  return (
    <div role="note" aria-label="Situação da configuração" className="grid gap-2 sm:grid-cols-3">
      {DRAFT_BANNERS.map((b) => (
        <p key={b} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span>{b}</span>
        </p>
      ))}
    </div>
  )
}

/** Ativação visível porém SEMPRE desabilitada (não existe RPC de ativação). */
export function ActivateDisabled({ id }: { id: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-describedby={`${id}-activate-reason`}
        className="inline-flex h-9 cursor-not-allowed items-center gap-1 rounded-md border border-border px-3 text-sm text-muted-foreground opacity-70"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Ativar
      </button>
      <span id={`${id}-activate-reason`} className="text-xs text-muted-foreground">{ACTIVATE_DISABLED_REASON}</span>
    </span>
  )
}

const TONE: Record<VersionStatus, string> = {
  draft: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  superseded: "border-border bg-muted/40 text-muted-foreground",
  archived: "border-border bg-muted/40 text-muted-foreground",
}
export function VersionPill({ status, version }: { status: VersionStatus; version: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[status])}>
      v{version} · {VERSION_STATUS_LABEL[status]}
    </span>
  )
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const LOAD_ERROR: Record<string, string> = {
  unauthenticated: "Sessão não encontrada. Faça login novamente.",
  forbidden: "Acesso não permitido para este perfil.",
  not_found: "Funcionário não encontrado.",
  unavailable: "Não foi possível carregar a configuração agora. Tente novamente em instantes.",
}
export function ConfigLoadError({ kind }: { kind: string }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <p className="font-medium text-foreground">Configuração indisponível</p>
      <p className="mt-1 text-sm text-muted-foreground">{LOAD_ERROR[kind] ?? LOAD_ERROR.unavailable}</p>
    </div>
  )
}

export const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
export const checkboxClass = "h-4 w-4 shrink-0 rounded border-input accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-primary"
