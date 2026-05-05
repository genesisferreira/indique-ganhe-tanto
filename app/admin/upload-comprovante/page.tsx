"use client"

import { useState } from "react"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { pagamentos } from "@/lib/services/mock-data.service"
import type { Pagamento } from "@/types"
import { Upload, FileText, CheckCircle, AlertCircle, Image, X, Search } from "lucide-react"

export default function AdminUploadComprovantePage() {
  const [selectedPagamento, setSelectedPagamento] = useState<string>("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle")
  const [search, setSearch] = useState("")

  const pagamentosPagos = pagamentos.filter((p: Pagamento) => p.status === "pago" && !p.comprovanteUrl)

  const filteredPagamentos = pagamentosPagos.filter((p: Pagamento) => {
    const indicacao = p.indicacao
    return indicacao?.nomeIndicado.toLowerCase().includes(search.toLowerCase()) ||
           p.indicador?.nome.toLowerCase().includes(search.toLowerCase())
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setUploadStatus("idle")
    }
  }

  const handleUpload = () => {
    if (!selectedFile || !selectedPagamento) return
    
    // Simulate upload
    setTimeout(() => {
      setUploadStatus("success")
      setSelectedFile(null)
      setSelectedPagamento("")
    }, 1500)
  }

  const selectedPagamentoData = pagamentos.find((p: Pagamento) => p.id === selectedPagamento)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload de Comprovante"
        description="Anexe comprovantes de pagamento para os indicadores"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">Selecionar Pagamento</CardTitle>
            <CardDescription>
              Escolha o pagamento que deseja anexar o comprovante
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredPagamentos.length > 0 ? (
                filteredPagamentos.map((pagamento: Pagamento) => (
                  <div
                    key={pagamento.id}
                    className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedPagamento === pagamento.id
                        ? "border-primary bg-primary/5"
                        : "border-border/50 bg-muted/30 hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedPagamento(pagamento.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
                        <CheckCircle className="h-5 w-5 text-success" />
                      </div>
                      <div>
                        <p className="font-medium">{pagamento.indicador?.nome || "N/A"}</p>
                        <p className="text-sm text-muted-foreground">
                          {pagamento.indicacao?.nomeIndicado || "Indicado"} - {pagamento.indicacao?.plano?.nome || "Plano"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-success">
                        R$ {pagamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(pagamento.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="h-10 w-10 text-success/50 mb-3" />
                  <p className="text-sm font-medium">Todos os comprovantes anexados</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Nao ha pagamentos pendentes de comprovante
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">Upload do Arquivo</CardTitle>
            <CardDescription>
              Selecione a imagem ou PDF do comprovante
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedPagamentoData && (
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm font-medium mb-2">Pagamento Selecionado:</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{selectedPagamentoData.indicador?.nome}</p>
                    <p className="text-sm text-muted-foreground">{selectedPagamentoData.indicacao?.nomeIndicado}</p>
                  </div>
                  <p className="text-lg font-bold text-success">
                    R$ {selectedPagamentoData.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Arquivo do Comprovante</Label>
              <div className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2">
                      {selectedFile.type.includes("image") ? (
                        <Image className="h-8 w-8 text-primary" />
                      ) : (
                        <FileText className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedFile(null)}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                    <div>
                      <p className="font-medium">Arraste e solte ou clique para selecionar</p>
                      <p className="text-sm text-muted-foreground">PNG, JPG ou PDF ate 5MB</p>
                    </div>
                    <Input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      id="file-upload"
                    />
                    <Label htmlFor="file-upload" className="cursor-pointer">
                      <Button variant="outline" asChild>
                        <span>Selecionar Arquivo</span>
                      </Button>
                    </Label>
                  </div>
                )}
              </div>
            </div>

            {uploadStatus === "success" && (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 p-4 text-success">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm font-medium">Comprovante enviado com sucesso!</span>
              </div>
            )}

            {uploadStatus === "error" && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm font-medium">Erro ao enviar comprovante. Tente novamente.</span>
              </div>
            )}

            <Button
              className="w-full"
              disabled={!selectedFile || !selectedPagamento}
              onClick={handleUpload}
            >
              <Upload className="mr-2 h-4 w-4" />
              Enviar Comprovante
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
