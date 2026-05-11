import { cn } from "@/lib/utils"

type StatusType =
  | "pendente"
  | "em_andamento"
  | "aprovada"
  | "recusada"
  | "paga"
  | "novo"
  | "em_atendimento"
  | "sem_contato"
  | "em_negociacao"
  | "vendido"
  | "perdido"
  | "redistribuido"
  | "disponivel"
  | "em_pausa"
  | "offline"
  | "aprovado"
  | "pago"
  | "cancelado"
  | "rejeitado"

interface StatusBadgeProps {
  status: StatusType
  className?: string
}

const statusConfig: Record<
  StatusType,
  { label: string; className: string }
> = {
  pendente: {
    label: "Pendente",
    className: "bg-warning/20 text-warning border-warning/30",
  },
  em_andamento: {
    label: "Em Andamento",
    className: "bg-info/20 text-info border-info/30",
  },
  aprovada: {
    label: "Aprovada",
    className: "bg-success/20 text-success border-success/30",
  },
  recusada: {
    label: "Recusada",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
  paga: {
    label: "Paga",
    className: "bg-primary/20 text-primary border-primary/30",
  },
  novo: {
    label: "Novo",
    className: "bg-primary/20 text-primary border-primary/30",
  },
  em_atendimento: {
    label: "Em Atendimento",
    className: "bg-info/20 text-info border-info/30",
  },
  sem_contato: {
    label: "Sem Contato",
    className: "bg-warning/20 text-warning border-warning/30",
  },
  em_negociacao: {
    label: "Em Negociação",
    className: "bg-info/20 text-info border-info/30",
  },
  vendido: {
    label: "Vendido",
    className: "bg-success/20 text-success border-success/30",
  },
  perdido: {
    label: "Perdido",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
  redistribuido: {
    label: "Redistribuído",
    className: "bg-warning/20 text-warning border-warning/30",
  },
  disponivel: {
    label: "Disponível",
    className: "bg-success/20 text-success border-success/30",
  },
  em_pausa: {
    label: "Em Pausa",
    className: "bg-warning/20 text-warning border-warning/30",
  },
  offline: {
    label: "Offline",
    className: "bg-muted text-muted-foreground border-muted",
  },
  aprovado: {
    label: "Aprovado",
    className: "bg-success/20 text-success border-success/30",
  },
  pago: {
    label: "Pago",
    className: "bg-primary/20 text-primary border-primary/30",
  },
  cancelado: {
    label: "Cancelado",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
  rejeitado: {
    label: "Rejeitado",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}
