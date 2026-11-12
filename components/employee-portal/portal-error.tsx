import { ErrorState } from "@/components/employee-portal/portal-ui"
import type { PortalErrorKind } from "@/lib/employee-portal/contracts"

const COPY: Record<PortalErrorKind, { title: string; description: string }> = {
  unauthenticated: { title: "Sessão expirada", description: "Entre novamente para ver seus dados." },
  forbidden: {
    title: "Acesso indisponível",
    description: "Seu perfil não tem acesso a esta área no momento. Se você acredita que isso é um erro, procure o administrador.",
  },
  not_found: { title: "Registro não encontrado", description: "Este registro não existe ou não está disponível para você." },
  invalid: { title: "Filtro inválido", description: "Revise os filtros e tente novamente." },
  unavailable: { title: "Não foi possível carregar", description: "Tente novamente em alguns instantes." },
}

export function PortalError({ kind }: { kind: PortalErrorKind }) {
  return <ErrorState {...COPY[kind]} />
}
