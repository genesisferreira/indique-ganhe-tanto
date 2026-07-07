"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { User, Mail, Phone, Calendar, Shield, Save } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import type { AuthProfileBasics } from "@/types/auth-profile"

function initialsFromName(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function AdminPerfilPage() {
  const [profile, setProfile] = useState<AuthProfileBasics | null>(null)
  const [noSession, setNoSession] = useState(false)

  useEffect(() => {
    void (async () => {
      if (isDataProviderMock()) {
        setProfile({
          id: "mock-admin",
          fullName: "Admin Demo",
          email: "admin@demo.local",
          phone: "",
          role: "admin_master",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        })
        return
      }
      const basics = await getAuthProfileBasicsFromSupabase()
      if (!basics) {
        setNoSession(true)
        return
      }
      setProfile(basics)
    })()
  }, [])

  const initials = useMemo(
    () => (profile?.fullName ? initialsFromName(profile.fullName) : "—"),
    [profile?.fullName]
  )

  const memberSince =
    profile?.createdAt != null
      ? new Date(profile.createdAt).toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        })
      : "—"

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

  if (!profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Carregando perfil…
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Meu Perfil"
        description="Informações da conta administrativa"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-xl border bg-card p-6 text-center">
            <Avatar className="w-24 h-24 mx-auto mb-4">
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-semibold text-foreground">
              {profile.fullName || "—"}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {formatUserRoleLabel(profile.role)}
            </p>

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
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Perfil</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatUserRoleLabel(profile.role)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Informações da conta
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="nome"
                    defaultValue={profile.fullName}
                    className="pl-9"
                    readOnly
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
                    defaultValue={profile.email}
                    className="pl-9"
                    readOnly
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
                    defaultValue={profile.phone ?? ""}
                    className="pl-9"
                    readOnly
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Edição de perfil administrativo ainda é somente leitura nesta tela.
            </p>
            <div className="mt-6 flex justify-end">
              <Button type="button" disabled>
                <Save className="w-4 h-4 mr-2" />
                Salvar alterações
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
