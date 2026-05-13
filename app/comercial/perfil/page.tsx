"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { User, Mail, Phone, Calendar, Eye, EyeOff, Lock, Save } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { StatusBadge } from "@/components/ui/status-badge"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { mockDataService } from "@/lib/services/mock-data.service"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import type { AuthProfileBasics } from "@/types/auth-profile"
import type { ComercialDisponibilidade } from "@/types/profile"

function initialsFromName(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function PerfilComercialPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [profile, setProfile] = useState<AuthProfileBasics | null>(null)
  const [noSession, setNoSession] = useState(false)
  const [disponibilidade, setDisponibilidade] =
    useState<ComercialDisponibilidade>("disponivel")
  const [vendasRealizadas, setVendasRealizadas] = useState(0)

  useEffect(() => {
    void (async () => {
      if (isDataProviderMock()) {
        const snap = mockDataService.getSnapshot()
        const c = snap.currentComercial
        setProfile({
          id: c.id,
          fullName: c.nome,
          email: c.email,
          phone: c.telefone,
          role: "comercial",
          avatarUrl: null,
          createdAt: c.createdAt.toISOString(),
        })
        setDisponibilidade(c.disponibilidade)
        setVendasRealizadas(c.vendasRealizadas)
        return
      }
      const b = await getAuthProfileBasicsFromSupabase()
      if (!b) {
        setNoSession(true)
        return
      }
      setProfile(b)
      setDisponibilidade("disponivel")
      setVendasRealizadas(0)
    })()
  }, [])

  const displayName = profile?.fullName ?? ""
  const displayEmail = profile?.email ?? ""
  const displayPhone = profile?.phone ?? ""
  const initials = useMemo(
    () => (displayName ? initialsFromName(displayName) : "—"),
    [displayName]
  )

  const memberSince =
    profile?.createdAt != null
      ? new Date(profile.createdAt).toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        })
      : "—"

  const handleSaveProfile = async () => {
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
  }

  if (!isDataProviderMock() && noSession) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
        <p>Sessão não encontrada ou perfil indisponível.</p>
        <Button asChild variant="default">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    )
  }

  if (!profile && !isDataProviderMock() && !noSession) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Carregando perfil…
      </div>
    )
  }

  if (!profile) {
    return null
  }

  return (
    <div>
      <PageHeader
        title="Meu Perfil"
        description="Gerencie suas informações pessoais"
      />

      <div className="grid gap-6 lg:grid-cols-3" key={profile.id}>
        <div className="lg:col-span-1">
          <div className="rounded-xl border bg-card p-6 text-center">
            <Avatar className="w-24 h-24 mx-auto mb-4">
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-semibold text-foreground">
              {displayName || "—"}
            </h2>
            <p className="text-sm text-muted-foreground mb-2">
              {formatUserRoleLabel(profile.role)}
            </p>
            <StatusBadge status={disponibilidade} />

            <div className="mt-6 pt-6 border-t border-border space-y-4 text-left">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Membro desde</p>
                  <p className="text-sm font-medium text-foreground">{memberSince}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Vendas Realizadas
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {vendasRealizadas}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Informações Pessoais
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome Completo</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="nome"
                    defaultValue={displayName}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    defaultValue={displayEmail}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="telefone">Telefone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="telefone"
                    type="tel"
                    defaultValue={displayPhone}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={handleSaveProfile} disabled={isLoading}>
                <Save className="w-4 h-4 mr-2" />
                {isLoading ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Alterar Senha
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Senha Atual</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Digite sua senha atual"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">Nova Senha</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="Mínimo 8 caracteres"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmNewPassword">Confirmar Nova Senha</Label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    placeholder="Confirme a nova senha"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="outline">Alterar Senha</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
