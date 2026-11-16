"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { isPartnerPublicUrl } from "@/lib/partner-merchants/public-url"
import { partnerQrMatrix, partnerQrSvg } from "@/lib/partner-merchants/qr-matrix"

type Capability = "master" | "finance" | "commercial" | "readonly" | "none"

function newKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

async function readJson(response: Response) {
  return response.json().catch(() => null)
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  terminated: "Encerrado",
}

export function PartnerList({ basePath }: { basePath: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  const [capability, setCapability] = useState<Capability>("none")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void fetch("/api/admin/parceiros").then(async (response) => {
      const body = await readJson(response)
      if (!response.ok) {
        setError(body?.message ?? "Não foi possível carregar.")
        return
      }
      setCapability(body.capability)
      setItems(body.items ?? [])
    })
  }, [])
  return (
    <div className="space-y-4 px-4 py-6">
      <PageHeader title="Comércios parceiros" description="Origem, indicações e regra de remuneração. Sem comissão gerada nesta entrega.">
        {capability === "master" ? <Button asChild><Link href={`${basePath}/novo`}>Novo comércio</Link></Button> : null}
      </PageHeader>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      <div className="grid gap-3">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum comércio cadastrado.</p> : null}
        {items.map((item) => (
          <Link key={String(item.id)} href={`${basePath}/${item.id}`} className="block rounded-lg border p-4 hover:bg-muted/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{String(item.publicDisplayName ?? "")}</p>
                <p className="text-sm text-muted-foreground">{String(item.legalName ?? "")}</p>
              </div>
              <Badge variant="outline">{STATUS_LABEL[String(item.status)] ?? String(item.status)}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Indicações: {String(item.referralCount ?? 0)} · Conversões: {String(item.conversionCount ?? 0)} · Link ativo: {item.hasActiveLink ? "sim" : "não"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function PartnerCreate({ basePath }: { basePath: string }) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function onSubmit(formData: FormData) {
    setPending(true)
    setMessage(null)
    const payload = {
      idempotencyKey: newKey(),
      legalName: String(formData.get("legalName") ?? ""),
      tradeName: String(formData.get("tradeName") ?? ""),
      publicDisplayName: String(formData.get("publicDisplayName") ?? ""),
      responsibleName: String(formData.get("responsibleName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      cnpj: String(formData.get("cnpj") ?? ""),
      address: String(formData.get("address") ?? ""),
      publishCnpj: formData.get("publishCnpj") === "on",
    }
    const response = await fetch("/api/admin/parceiros", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
    const body = await readJson(response)
    setPending(false)
    if (!response.ok) {
      setMessage(body?.message ?? "Não foi possível cadastrar.")
      return
    }
    window.location.href = `${basePath}/${body.id}`
  }
  return (
    <div className="px-4 py-6">
      <PageHeader title="Novo comércio parceiro" description="O cadastro nasce em rascunho. Nenhum link ou regra é criado automaticamente." />
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form className="grid gap-3" action={onSubmit}>
            <Labeled name="legalName" label="Nome empresarial" />
            <Labeled name="tradeName" label="Nome fantasia" />
            <Labeled name="publicDisplayName" label="Nome público" />
            <Labeled name="responsibleName" label="Responsável" />
            <Labeled name="phone" label="Telefone" />
            <Labeled name="email" label="E-mail (opcional)" required={false} />
            <Labeled name="cnpj" label="CNPJ (opcional)" required={false} />
            <Labeled name="address" label="Endereço (opcional)" required={false} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="publishCnpj" /> Mostrar CNPJ no formulário público</label>
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Cadastrar rascunho"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export function PartnerDetail({ id, basePath, showFinancial }: { id: string; basePath: string; showFinancial: boolean }) {
  const [data, setData] = useState<Record<string, any> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ url: string; token: string } | null>(null)
  useEffect(() => {
    void fetch(`/api/admin/parceiros/${id}`).then(async (response) => {
      const body = await readJson(response)
      if (response.ok) setData(body)
      else setMessage(body?.message ?? "Não foi possível carregar.")
    })
  }, [id])
  const merchant = data?.merchant
  const capability = data?.capability as Capability | undefined
  async function setStatus(status: string, reason: string) {
    const response = await fetch(`/api/admin/parceiros/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: newKey(), id, status, reason }),
    })
    const body = await readJson(response)
    setMessage(body?.message ?? (response.ok ? "Status atualizado." : "Não foi possível atualizar."))
    if (response.ok) window.location.reload()
  }
  async function issue(mode: "issue" | "rotate") {
    const response = await fetch(`/api/admin/parceiros/${id}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: newKey(), partnerId: id, mode }),
    })
    const body = await readJson(response)
    if (body?.token && body?.url) setReveal({ token: body.token, url: body.url })
    else setMessage(body?.message ?? (body?.tokenRevealed === false ? "O link já foi emitido. Rotacione para gerar outro." : "Não foi possível gerar o link."))
  }
  if (!data && !message) return <p className="px-4 py-6 text-sm text-muted-foreground">Carregando…</p>
  if (!merchant) return <p className="px-4 py-6 text-sm">{message}</p>
  return (
    <div className="space-y-4 px-4 py-6">
      <PageHeader title={merchant.publicDisplayName} description={merchant.legalName}>
        <Badge variant="outline">{STATUS_LABEL[merchant.status] ?? merchant.status}</Badge>
      </PageHeader>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="underline" href={`${basePath}/${id}/indicacoes`}>Indicações</Link>
        {showFinancial && capability !== "commercial" && capability !== "readonly" ? <Link className="underline" href={`/admin/parceiros/${id}/remuneracao`}>Remuneração</Link> : null}
      </div>
      <Card>
        <CardHeader><CardTitle>Cadastro</CardTitle></CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>Responsável: {merchant.responsibleName}</p>
          <p>Telefone: {merchant.phone}</p>
          <p>E-mail: {merchant.email || "—"}</p>
          <p>CNPJ: {merchant.cnpj || "—"}</p>
          <p>Endereço: {merchant.address || "—"}</p>
          <p>Link ativo: {merchant.hasActiveLink ? "sim" : "não"}{merchant.campaignCode ? ` · campanha ${merchant.campaignCode}` : ""}</p>
          <p>Indicações: {data.referralCount} · Conversões: {data.conversionCount} · Tentativas concorrentes: {data.competingAttempts}</p>
          {merchant.statusReason ? <p>Motivo: {merchant.statusReason}</p> : null}
        </CardContent>
      </Card>
      {capability === "master" ? (
        <Card>
          <CardHeader><CardTitle>Status, link e QR</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {merchant.status !== "active" ? <Button type="button" onClick={() => void setStatus("active", merchant.status === "draft" ? "" : "Reativação administrativa do comércio.")}>Ativar</Button> : null}
              {merchant.status === "active" ? <Button type="button" variant="outline" onClick={() => void setStatus("paused", "Pausa administrativa do comércio parceiro.")}>Pausar</Button> : null}
              {merchant.status !== "terminated" ? <Button type="button" variant="outline" onClick={() => void setStatus("terminated", "Encerramento administrativo do comércio parceiro.")}>Encerrar</Button> : null}
              {merchant.status === "active" && !merchant.hasActiveLink ? <Button type="button" onClick={() => void issue("issue")}>Gerar link</Button> : null}
              {merchant.status === "active" && merchant.hasActiveLink ? <Button type="button" variant="outline" onClick={() => void issue("rotate")}>Rotacionar link</Button> : null}
            </div>
            <p className="text-xs text-muted-foreground">Pausa, reativação e encerramento exigem motivo. O comércio com histórico não é apagado. O token aparece só na criação ou rotação.</p>
            {reveal ? <QrReveal url={reveal.url} displayName={merchant.publicDisplayName} /> : null}
          </CardContent>
        </Card>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Card>
        <CardHeader><CardTitle>Auditoria</CardTitle></CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {(data.audit ?? []).length === 0 ? <p className="text-muted-foreground">Sem eventos.</p> : null}
          {(data.audit ?? []).map((event: { eventType: string; createdAt: string; reason?: string }, index: number) => (
            <p key={`${event.createdAt}-${index}`}>{event.eventType} · {new Date(event.createdAt).toLocaleString("pt-BR")}{event.reason ? ` · ${event.reason}` : ""}</p>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function QrReveal({ url, displayName }: { url: string; displayName: string }) {
  const [svg, setSvg] = useState("")
  const [png, setPng] = useState("")
  useEffect(() => {
    if (!isPartnerPublicUrl(url)) return
    setSvg(partnerQrSvg(url))
    const matrix = partnerQrMatrix(url)
    const margin = 2
    const count = matrix.length
    const scale = Math.max(8, Math.ceil(1024 / (count + margin * 2)))
    const size = (count + margin * 2) * scale
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext("2d")
    if (!context) return
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size, size)
    context.fillStyle = "#000000"
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (matrix[row][column]) context.fillRect((column + margin) * scale, (row + margin) * scale, scale, scale)
      }
    }
    setPng(canvas.toDataURL("image/png"))
  }, [url])
  return (
    <div className="partner-qr-sheet grid gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">{displayName}</p>
      <p className="break-all text-xs">{url}</p>
      {png ? <img src={png} alt="" className="h-40 w-40" /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => downloadText("comercio-parceiro.svg", svg, "image/svg+xml")}>Baixar SVG</Button>
        <Button type="button" variant="outline" onClick={() => downloadDataUrl("comercio-parceiro.png", png)}>Baixar PNG</Button>
        <Button type="button" variant="outline" onClick={() => window.print()}>Imprimir</Button>
      </div>
      <style>{`@media print { body * { visibility: hidden } .partner-qr-sheet, .partner-qr-sheet * { visibility: visible } .partner-qr-sheet { position: absolute; left: 0; top: 0 } .partner-qr-sheet img { width: 6cm; height: 6cm } }`}</style>
    </div>
  )
}

function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}

function downloadDataUrl(name: string, dataUrl: string) {
  const anchor = document.createElement("a")
  anchor.href = dataUrl
  anchor.download = name
  anchor.click()
}

export function PartnerReferrals({ id }: { id: string }) {
  const [items, setItems] = useState<Array<Record<string, string>>>([])
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void fetch(`/api/admin/parceiros/${id}/indicacoes`).then(async (response) => {
      const body = await readJson(response)
      if (!response.ok) setMessage(body?.message ?? "Não foi possível carregar.")
      else setItems(body.items ?? [])
    })
  }, [id])
  return (
    <div className="space-y-4 px-4 py-6">
      <PageHeader title="Indicações do comércio" description="Contagens reais. Nenhuma comissão é gerada nesta entrega." />
      {message ? <p className="text-sm">{message}</p> : null}
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma indicação.</p> : null}
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={item.protocol} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{item.name}</p>
            <p>{item.phone}</p>
            <p className="text-muted-foreground">Protocolo {item.protocol} · {item.stage} · {item.status}</p>
            <p className="text-xs">Comércio parceiro · {item.publicDisplayName}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PartnerCompensation({ id }: { id: string }) {
  const [data, setData] = useState<Record<string, any> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [bps, setBps] = useState("")
  useEffect(() => {
    void fetch(`/api/admin/parceiros/${id}`).then(async (response) => {
      const body = await readJson(response)
      if (!response.ok || body?.rule === undefined && body?.capability && !["master", "finance"].includes(body.capability)) {
        setMessage(body?.capability && !["master", "finance"].includes(body.capability) ? "Remuneração indisponível para este perfil." : (body?.message ?? "Não foi possível carregar."))
        return
      }
      if (!["master", "finance"].includes(body.capability)) {
        setMessage("Remuneração indisponível para este perfil.")
        return
      }
      setData(body)
    })
  }, [id])
  async function reconcile() {
    const response = await fetch(`/api/admin/parceiros/${id}/reconciliar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: newKey() }),
    })
    const body = await readJson(response)
    setMessage(response.ok
      ? `Reconciliação concluída. Direitos apurados nesta execução: ${body?.accrued ?? 0}. Nenhuma chamada ao ERP.`
      : (body?.message ?? "Não foi possível reconciliar."))
  }
  async function save(kind: string) {
    const cents = Math.round(Number(amount.replace(",", ".")) * 100)
    const payload: Record<string, unknown> = { idempotencyKey: newKey(), partnerId: id, kind }
    if (kind === "fixed_amount") payload.fixedAmountCents = cents
    if (kind === "percentage") payload.percentageBps = Number(bps)
    const response = await fetch(`/api/admin/parceiros/${id}/regra`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const body = await readJson(response)
    setMessage(body?.message ?? (response.ok ? `Regra ${body.status}. Nenhuma comissão foi criada.` : "Não foi possível salvar."))
    if (response.ok) window.location.reload()
  }
  if (message && !data) return <p className="px-4 py-6 text-sm">{message}</p>
  const rule = data?.rule
  return (
    <div className="space-y-4 px-4 py-6">
      <PageHeader title="Remuneração do comércio" description="O valor fixo fica elegível ao ser configurado. A comissão só nasce na reconciliação, quando já existe uma fatura válida. Percentual e primeira fatura permanecem bloqueados." />
      <Card>
        <CardHeader><CardTitle>Regra vigente</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {rule ? (
            <p>{rule.kind} · {rule.status} · gatilho {rule.triggerKind}{rule.blockReason ? ` · ${rule.blockReason}` : ""}{rule.fixedAmountCents ? ` · R$ ${(rule.fixedAmountCents / 100).toFixed(2)}` : ""}</p>
          ) : <p className="text-muted-foreground">Nenhuma regra configurada.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <Label>Valor fixo (R$), definido aqui</Label>
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="" />
          <Button type="button" onClick={() => void save("fixed_amount")}>Configurar valor fixo</Button>
          {rule?.kind === "fixed_amount" && rule?.status === "configured" ? (
            <Button type="button" variant="outline" onClick={() => void reconcile()}>Reconciliar comissão fixa</Button>
          ) : null}
          <Label>Percentual em basis points (estrutura bloqueada)</Label>
          <Input value={bps} onChange={(event) => setBps(event.target.value)} inputMode="numeric" />
          <Button type="button" variant="outline" onClick={() => void save("percentage")}>Registrar percentual bloqueado</Button>
          <Button type="button" variant="outline" onClick={() => void save("first_invoice_value")}>Registrar primeira fatura bloqueada</Button>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Labeled({ name, label, required = true }: { name: string; label: string; required?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required={required} className="w-full" />
    </div>
  )
}
