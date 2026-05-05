"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { planos } from "@/lib/services/mock-data.service"
import { Plus, Edit, Trash2, Wifi, DollarSign, Gift, Package } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import type { Plano } from "@/types"

export default function AdminPlanosPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const totalPlanos = planos.length
  const planosAtivos = planos.filter((p: Plano) => p.ativo).length
  const precoMedio = planos.reduce((acc: number, p: Plano) => acc + p.preco, 0) / planos.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gerenciar Planos"
        description="Configure os planos de internet disponiveis para indicacao"
      >
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Plano
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Cadastrar Novo Plano</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nome">Nome do Plano</Label>
                <Input id="nome" placeholder="Ex: Turbo 500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="velocidade">Velocidade</Label>
                  <Input id="velocidade" placeholder="Ex: 500 Mbps" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="preco">Preco (R$)</Label>
                  <Input id="preco" type="number" placeholder="99.90" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="valorRecompensa">Valor da Recompensa (R$)</Label>
                <Input id="valorRecompensa" type="number" placeholder="50.00" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descricao">Descricao</Label>
                <Textarea id="descricao" placeholder="Descreva os beneficios do plano" />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ativo">Plano Ativo</Label>
                <Switch id="ativo" defaultChecked />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setIsDialogOpen(false)}>
                Cadastrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total de Planos"
          value={totalPlanos}
          icon={Package}
        />
        <StatCard
          title="Planos Ativos"
          value={planosAtivos}
          icon={Wifi}
          variant="success"
        />
        <StatCard
          title="Preco Medio"
          value={`R$ ${precoMedio.toFixed(2)}`}
          icon={DollarSign}
          variant="primary"
        />
        <StatCard
          title="Recompensa Media"
          value="R$ 50,00"
          icon={Gift}
          variant="warning"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {planos.length > 0 ? (
          planos.map((plano: Plano) => (
            <Card key={plano.id} className="border-border/50 bg-card/50 relative overflow-hidden">
              {!plano.ativo && (
                <div className="absolute inset-0 bg-background/80 z-10 flex items-center justify-center">
                  <span className="text-sm font-medium text-muted-foreground">Plano Inativo</span>
                </div>
              )}
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{plano.nome}</CardTitle>
                    <p className="text-sm text-muted-foreground">{plano.velocidade}</p>
                  </div>
                  <StatusBadge status={plano.ativo ? "disponivel" : "offline"} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{plano.descricao}</p>
                
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-primary">
                    R$ {plano.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-sm text-muted-foreground">/mes</span>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3">
                  <Gift className="h-5 w-5 text-success" />
                  <div>
                    <p className="text-xs text-muted-foreground">Recompensa por Indicacao</p>
                    <p className="font-semibold text-success">
                      R$ {(plano.valorRecompensa || 50).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="col-span-full border-border/50 bg-card/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum plano cadastrado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Clique em Novo Plano para adicionar o primeiro plano
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
