"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { comerciais } from "@/lib/services/mock-data.service"
import { loadAdminComerciaisFromSupabase } from "@/lib/services/supabase-data.service"
import type { Comercial } from "@/types"

export default function AdminComercialDetalhePage() {
  const params = useParams<{ id: string }>()
  const comercialId = params.id
  const [comercial, setComercial] = useState<Comercial | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      if (isDataProviderMock()) {
        const found = comerciais.find((item) => item.id === comercialId) ?? null
        setComercial(found)
        setNotFound(!found)
        setLoading(false)
        return
      }

      const lista = await loadAdminComerciaisFromSupabase()
      const found = (lista ?? []).find((item) => item.id === comercialId) ?? null
      setComercial(found)
      setNotFound(!found)
      setLoading(false)
    })()
  }, [comercialId])

  if (loading) {
    return (
      <p className="text-muted-foreground">Carregando comercial…</p>
    )
  }

  if (notFound || !comercial) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Comercial não encontrado"
          description="O comercial solicitado não existe ou não está mais disponível."
        />
        <Button asChild variant="outline">
          <Link href="/admin/comerciais">Voltar para comerciais</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={comercial.nome}
          description="Detalhes do comercial"
        />
        <Button asChild variant="outline">
          <Link href="/admin/comerciais">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">E-mail:</span> {comercial.email}
          </p>
          <p>
            <span className="text-muted-foreground">Telefone:</span>{" "}
            {comercial.telefone}
          </p>
          <p className="flex items-center gap-2">
            <span className="text-muted-foreground">Disponibilidade:</span>
            <StatusBadge status={comercial.disponibilidade} />
          </p>
          <p>
            <span className="text-muted-foreground">Leads ativos:</span>{" "}
            {comercial.leadsAtivos}
          </p>
          <p>
            <span className="text-muted-foreground">Vendas realizadas:</span>{" "}
            {comercial.vendasRealizadas}
          </p>
          <p>
            <span className="text-muted-foreground">Tempo médio 1º contato:</span>{" "}
            {comercial.tempoMedioPrimeiroContato} min
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
