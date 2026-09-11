"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/ui/data-table"
import { ADMIN_SECTORS_VISIBLE_COLUMNS } from "@/lib/employees/admin-policy"

type SectorRow = {
  code: string
  name: string
  description: string | null
  isActive: boolean
  activeMemberCount: number
}

export default function AdminSetoresPage() {
  const [items, setItems] = useState<SectorRow[]>([])

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/sectors", { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.ok) setItems(json.items ?? [])
    })()
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setores"
        description="Catálogo organizacional existente. Somente visualização: códigos estruturais não podem ser alterados nesta sprint."
      />
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Catálogo</CardTitle>
          <CardDescription>Os nomes vêm do banco. Nenhum setor estrutural é excluído por esta tela.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={items}
            getRowKey={(item) => item.code}
            emptyMessage="Nenhum setor cadastrado."
            columns={[
              {
                key: ADMIN_SECTORS_VISIBLE_COLUMNS[0].key,
                header: ADMIN_SECTORS_VISIBLE_COLUMNS[0].header,
                cell: (item) => <span className="font-medium">{item.name}</span>,
              },
              {
                key: ADMIN_SECTORS_VISIBLE_COLUMNS[1].key,
                header: ADMIN_SECTORS_VISIBLE_COLUMNS[1].header,
                cell: (item) => (
                  <span className="font-mono text-sm text-muted-foreground">{item.code}</span>
                ),
              },
              {
                key: ADMIN_SECTORS_VISIBLE_COLUMNS[2].key,
                header: ADMIN_SECTORS_VISIBLE_COLUMNS[2].header,
                cell: (item) => (
                  <span className="text-sm text-muted-foreground">{item.description || "—"}</span>
                ),
              },
              {
                key: ADMIN_SECTORS_VISIBLE_COLUMNS[3].key,
                header: ADMIN_SECTORS_VISIBLE_COLUMNS[3].header,
                cell: (item) => (
                  <Badge variant={item.isActive ? "default" : "secondary"}>
                    {item.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                ),
              },
              {
                key: ADMIN_SECTORS_VISIBLE_COLUMNS[4].key,
                header: ADMIN_SECTORS_VISIBLE_COLUMNS[4].header,
                cell: (item) => <span className="font-medium">{item.activeMemberCount}</span>,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
