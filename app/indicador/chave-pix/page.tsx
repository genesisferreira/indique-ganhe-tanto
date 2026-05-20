"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/ui/page-header"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { currentIndicador } from "@/lib/services/mock-data.service"
import {
  loadIndicadorPrimaryPixKeyFromSupabase,
  saveIndicadorPrimaryPixKeyFromSupabase,
} from "@/lib/services/supabase-data.service"
import { toast } from "sonner"
import type { TipoChavePix } from "@/types/profile"
import { Key, AlertTriangle, CheckCircle2, Pencil } from "lucide-react"

const pixTypes = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "aleatoria", label: "Chave Aleatória" },
] as const

const defaultTipo: TipoChavePix = "cpf"

export default function ChavePixPage() {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [tipoChave, setTipoChave] = useState<TipoChavePix>(defaultTipo)
  const [chave, setChave] = useState("")
  const [baselineTipo, setBaselineTipo] = useState<TipoChavePix>(defaultTipo)
  const [baselineChave, setBaselineChave] = useState("")

  useEffect(() => {
    if (isDataProviderMock()) {
      const t = currentIndicador.tipoChavePix ?? defaultTipo
      const v = currentIndicador.chavePix ?? ""
      setTipoChave(t)
      setChave(v)
      setBaselineTipo(t)
      setBaselineChave(v)
      if (process.env.NODE_ENV === "development") {
        console.log("[page-data:debug]", { page: "/indicador/chave-pix", source: "mock", total: 1 })
      }
      return
    }
    void (async () => {
      const row = await loadIndicadorPrimaryPixKeyFromSupabase()
      if (process.env.NODE_ENV === "development") {
        console.log("[page-data:debug]", {
          page: "/indicador/chave-pix",
          source: "supabase",
          total: row === null ? 0 : row.keyValue ? 1 : 0,
        })
      }
      if (row) {
        setTipoChave(row.keyType)
        setChave(row.keyValue)
        setBaselineTipo(row.keyType)
        setBaselineChave(row.keyValue)
      } else {
        setTipoChave(defaultTipo)
        setChave("")
        setBaselineTipo(defaultTipo)
        setBaselineChave("")
      }
    })()
  }, [])

  const reloadFromSupabase = async () => {
    const row = await loadIndicadorPrimaryPixKeyFromSupabase()
    if (row) {
      setTipoChave(row.keyType)
      setChave(row.keyValue)
      setBaselineTipo(row.keyType)
      setBaselineChave(row.keyValue)
    }
  }

  const handleSave = async () => {
    if (isDataProviderMock()) {
      setBaselineTipo(tipoChave)
      setBaselineChave(chave)
      setIsEditing(false)
      toast.success("Chave Pix salva (modo demonstração).")
      return
    }

    setIsLoading(true)
    try {
      const result = await saveIndicadorPrimaryPixKeyFromSupabase(tipoChave, chave)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      await reloadFromSupabase()
      setIsEditing(false)
      toast.success("Chave Pix salva com sucesso.")
    } finally {
      setIsLoading(false)
    }
  }

  const tipoLabel = pixTypes.find((t) => t.value === tipoChave)?.label

  return (
    <div>
      <PageHeader
        title="Minha Chave Pix"
        description="Gerencie sua chave Pix para receber pagamentos"
      />

      <div className="max-w-xl">
        {/* Current Key */}
        <div className="rounded-xl border bg-card p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Key className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Chave Cadastrada
                </h2>
                <p className="text-sm text-muted-foreground">
                  Tipo:{" "}
                  {tipoLabel}
                </p>
              </div>
            </div>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="w-4 h-4 mr-2" />
                Editar
              </Button>
            )}
          </div>

          {!isEditing ? (
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="font-mono text-lg text-foreground">
                {chave || "—"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tipo">Tipo de Chave</Label>
                <Select value={tipoChave} onValueChange={(v) => setTipoChave(v as TipoChavePix)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pixTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="chave">Chave Pix</Label>
                <Input
                  id="chave"
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder="Digite sua chave Pix"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false)
                    setTipoChave(baselineTipo)
                    setChave(baselineChave)
                  }}
                >
                  Cancelar
                </Button>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading ? "Salvando..." : "Salvar Alterações"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Warning */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/10 border border-warning/20 mb-6">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Atenção</p>
            <p className="text-muted-foreground mt-1">
              Certifique-se de que a chave Pix está correta. Pagamentos enviados
              para chaves incorretas podem não ser recuperados.
            </p>
          </div>
        </div>

        {/* Tips */}
        <div className="rounded-xl border bg-card p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Dicas sobre Chave Pix
          </h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
              <span>
                Use uma chave que você tenha fácil acesso para verificar
                recebimentos.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
              <span>
                Chaves de CPF e telefone são mais fáceis de lembrar.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
              <span>
                Chaves aleatórias oferecem mais privacidade.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
              <span>
                Você pode alterar sua chave a qualquer momento.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
