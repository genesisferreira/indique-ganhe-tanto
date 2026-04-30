"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Save, Plus, Trash2, DollarSign, Bell, Shield, Palette, Building } from "lucide-react"

export default function AdminConfiguracoesPage() {
  const [planos, setPlanos] = useState([
    { id: "1", nome: "100 Mega", valor: 79.90, comissao: 50 },
    { id: "2", nome: "200 Mega", valor: 99.90, comissao: 75 },
    { id: "3", nome: "300 Mega", valor: 129.90, comissao: 100 },
    { id: "4", nome: "500 Mega", valor: 159.90, comissao: 125 },
    { id: "5", nome: "1 Giga", valor: 199.90, comissao: 150 },
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Gerencie as configurações do sistema"
      />

      <Tabs defaultValue="empresa" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="empresa" className="gap-2">
            <Building className="h-4 w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger value="planos" className="gap-2">
            <DollarSign className="h-4 w-4" />
            Planos e Comissões
          </TabsTrigger>
          <TabsTrigger value="notificacoes" className="gap-2">
            <Bell className="h-4 w-4" />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="seguranca" className="gap-2">
            <Shield className="h-4 w-4" />
            Segurança
          </TabsTrigger>
          <TabsTrigger value="aparencia" className="gap-2">
            <Palette className="h-4 w-4" />
            Aparência
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Informações da Empresa</CardTitle>
              <CardDescription>Dados cadastrais e de contato</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nomeEmpresa">Nome da Empresa</Label>
                  <Input id="nomeEmpresa" defaultValue="Tanto Telecom" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input id="cnpj" defaultValue="12.345.678/0001-90" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="emailContato">E-mail de Contato</Label>
                  <Input id="emailContato" type="email" defaultValue="contato@tantotelecom.com.br" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telefoneContato">Telefone</Label>
                  <Input id="telefoneContato" defaultValue="(11) 3000-0000" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endereco">Endereço</Label>
                <Input id="endereco" defaultValue="Av. Paulista, 1000 - São Paulo/SP" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="descricao">Descrição</Label>
                <Textarea 
                  id="descricao" 
                  rows={3}
                  defaultValue="A Tanto Telecom é uma empresa de telecomunicações focada em oferecer internet de alta qualidade para residências e empresas."
                />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Alterações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="planos" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Planos e Comissões</CardTitle>
                  <CardDescription>Configure os planos disponíveis e valores de comissão</CardDescription>
                </div>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo Plano
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {planos.map((plano) => (
                  <div key={plano.id} className="flex items-center gap-4 rounded-lg bg-muted/30 p-4">
                    <div className="flex-1 grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Nome do Plano</Label>
                        <Input defaultValue={plano.nome} />
                      </div>
                      <div className="space-y-2">
                        <Label>Valor Mensal (R$)</Label>
                        <Input type="number" step="0.01" defaultValue={plano.valor} />
                      </div>
                      <div className="space-y-2">
                        <Label>Comissão (R$)</Label>
                        <Input type="number" step="0.01" defaultValue={plano.comissao} />
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button className="mt-4">
                <Save className="mr-2 h-4 w-4" />
                Salvar Planos
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Configurações de Pagamento</CardTitle>
              <CardDescription>Defina as regras de pagamento aos indicadores</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="valorMinimo">Valor Mínimo para Saque (R$)</Label>
                  <Input id="valorMinimo" type="number" step="0.01" defaultValue="50.00" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="diasProcessamento">Dias para Processamento</Label>
                  <Input id="diasProcessamento" type="number" defaultValue="3" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Aprovação Automática</p>
                  <p className="text-sm text-muted-foreground">Aprovar automaticamente pagamentos até um valor limite</p>
                </div>
                <Switch />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notificacoes" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Notificações por E-mail</CardTitle>
              <CardDescription>Configure quando e para quem enviar notificações</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Nova Indicação</p>
                  <p className="text-sm text-muted-foreground">Notificar comerciais quando uma nova indicação é cadastrada</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Indicação Convertida</p>
                  <p className="text-sm text-muted-foreground">Notificar indicador quando sua indicação é convertida</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Solicitação de Pagamento</p>
                  <p className="text-sm text-muted-foreground">Notificar admin quando um pagamento é solicitado</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Pagamento Processado</p>
                  <p className="text-sm text-muted-foreground">Notificar indicador quando o pagamento é efetuado</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Notificações WhatsApp</CardTitle>
              <CardDescription>Configure integração com WhatsApp Business API</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Ativar WhatsApp</p>
                  <p className="text-sm text-muted-foreground">Enviar notificações via WhatsApp</p>
                </div>
                <Switch />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappToken">Token da API</Label>
                <Input id="whatsappToken" type="password" placeholder="Seu token do WhatsApp Business" />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seguranca" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Política de Senhas</CardTitle>
              <CardDescription>Configure os requisitos de segurança para senhas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="minCaracteres">Mínimo de Caracteres</Label>
                  <Input id="minCaracteres" type="number" defaultValue="8" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiracao">Expiração (dias)</Label>
                  <Input id="expiracao" type="number" defaultValue="90" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Exigir Letra Maiúscula</p>
                  <p className="text-sm text-muted-foreground">A senha deve conter pelo menos uma letra maiúscula</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Exigir Número</p>
                  <p className="text-sm text-muted-foreground">A senha deve conter pelo menos um número</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Exigir Caractere Especial</p>
                  <p className="text-sm text-muted-foreground">A senha deve conter pelo menos um caractere especial</p>
                </div>
                <Switch />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Autenticação em Dois Fatores</CardTitle>
              <CardDescription>Configure 2FA para maior segurança</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Obrigatório para Admins</p>
                  <p className="text-sm text-muted-foreground">Exigir 2FA para todos os administradores</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
                <div>
                  <p className="font-medium">Disponível para Indicadores</p>
                  <p className="text-sm text-muted-foreground">Permitir que indicadores ativem 2FA</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aparencia" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Personalização Visual</CardTitle>
              <CardDescription>Customize as cores e a identidade visual do sistema</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="corPrimaria">Cor Primária</Label>
                  <div className="flex gap-2">
                    <Input id="corPrimaria" defaultValue="#FACC15" />
                    <div className="h-10 w-10 rounded-md bg-primary" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="corSecundaria">Cor Secundária</Label>
                  <div className="flex gap-2">
                    <Input id="corSecundaria" defaultValue="#1C1C1C" />
                    <div className="h-10 w-10 rounded-md bg-card" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Logo da Empresa</Label>
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-40 items-center justify-center rounded-lg bg-muted/30">
                    <span className="text-2xl font-bold text-primary">TANTO</span>
                  </div>
                  <Button variant="outline">Alterar Logo</Button>
                </div>
              </div>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Salvar Aparência
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
