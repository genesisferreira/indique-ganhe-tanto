import { NotificacoesLayoutClient } from "./notificacoes-layout-client"

export const dynamic = "force-dynamic"

export default function NotificacoesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <NotificacoesLayoutClient>{children}</NotificacoesLayoutClient>
}
