import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadFuncionarioSelfProfile } from "@/lib/employees/self-profile.service"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function FuncionarioPerfilPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) redirect("/login")

  const result = await loadFuncionarioSelfProfile({
    sessionUserId: user.id,
  })

  if (result.kind === "unauthenticated") redirect("/login")
  if (result.kind === "inactive") redirect("/conta-inativa")
  if (result.kind === "wrong_role") redirect("/")
  if (result.kind === "missing_employee" || result.kind === "dismissed") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Meu Perfil"
          description="Informações da sua conta de funcionário."
        />
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Perfil indisponível</CardTitle>
            <CardDescription>
              Não há um cadastro de funcionário ativo para esta conta.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const view = result.view

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu Perfil"
        description="Informações da sua conta de funcionário."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Dados pessoais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Nome:</span> {view.fullName}
            </p>
            <p>
              <span className="text-muted-foreground">E-mail:</span> {view.email}
            </p>
            <p>
              <span className="text-muted-foreground">Telefone:</span> {view.phone}
            </p>
            <p>
              <span className="text-muted-foreground">CPF:</span> {view.cpfMasked}
            </p>
            <p>
              <span className="text-muted-foreground">Data de nascimento:</span>{" "}
              {view.birthDateLabel}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Dados profissionais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Cargo:</span> {view.jobTitle}
            </p>
            <p>
              <span className="text-muted-foreground">Status:</span>{" "}
              {view.employeeStatusLabel}
            </p>
            <p>
              <span className="text-muted-foreground">Gestor direto:</span>{" "}
              {view.managerName}
            </p>
            <div>
              <p className="text-muted-foreground">Setores/funções</p>
              {view.memberships.length === 0 ? (
                <p>Nenhum setor atribuído.</p>
              ) : (
                <ul className="mt-1 list-disc pl-5">
                  {view.memberships.map((item) => (
                    <li key={`${item.name}-${item.isActive ? "on" : "off"}`}>
                      {item.name} ({item.isActive ? "ativo" : "inativo"})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 lg:col-span-2">
          <CardHeader>
            <CardTitle>Acesso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Identidade global:</span>{" "}
              funcionario
            </p>
            <p>
              <span className="text-muted-foreground">Situação da conta:</span>{" "}
              {view.accountStatusLabel}
            </p>
            <p>
              <span className="text-muted-foreground">Primeiro acesso:</span>{" "}
              {view.firstAccessLabel}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
