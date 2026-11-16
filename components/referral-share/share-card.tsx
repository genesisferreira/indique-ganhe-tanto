"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { partnerQrMatrix, partnerQrSvg } from "@/lib/partner-merchants/qr-matrix"

type LinkRow = {
  linkId: string
  attributionRole: string
  status: string
  useCount: number
  campaign?: string | null
  publicDisplayName?: string
}

const ROLE_LABEL: Record<string, string> = {
  indicator: "Meu link de indicação",
  technician_originator: "Link de Técnico de Rua",
  external_sales_originator: "Link de Vendedor Externo",
  partner_merchant_originator: "Link do comércio parceiro",
}

function newKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

function shareText(url: string) {
  return `Olá! Faça seu pré-cadastro na Tanto Telecom por este link: ${url}`
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function pngBlob(url: string): Promise<Blob> {
  const matrix = partnerQrMatrix(url)
  const scale = 8
  const margin = 2
  const size = (matrix.length + margin * 2) * scale
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return Promise.reject(new Error("canvas"))
  context.fillStyle = "#fff"
  context.fillRect(0, 0, size, size)
  context.fillStyle = "#000"
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale)
  }))
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), "image/png"))
}

export function ShareLinksCard({
  title,
  description,
  mode,
  originKind,
  originatorId,
  allowIssue = true,
}: {
  title: string
  description: string
  mode: "self" | "admin"
  originKind?: "indicator" | "employee" | "partner_merchant"
  originatorId?: string
  allowIssue?: boolean
}) {
  const [links, setLinks] = useState<LinkRow[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [confirmRole, setConfirmRole] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    const response = mode === "self"
      ? await fetch("/api/referral-share/mine")
      : await fetch(`/api/admin/share-links?originKind=${encodeURIComponent(originKind ?? "")}&originatorId=${encodeURIComponent(originatorId ?? "")}`)
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.ok) {
      setMessage(body?.message ?? "Não foi possível carregar o link.")
      return
    }
    setLinks(Array.isArray(body.links) ? body.links.filter((row: LinkRow) => row.status === "active" || mode === "admin") : [])
    setRoles(Array.isArray(body.eligibleRoles) ? body.eligibleRoles : [])
  }

  useEffect(() => { void load() }, [mode, originKind, originatorId])

  async function issue(role: string, actionMode: "issue" | "rotate") {
    const endpoint = mode === "self" ? "/api/referral-share/mine" : "/api/admin/share-links"
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "issue",
        idempotencyKey: newKey(),
        mode: actionMode,
        originKind: originKind ?? (role === "indicator" ? "indicator" : "employee"),
        attributionRole: role,
        originatorId,
      }),
    })
    const body = await response.json().catch(() => null)
    if (body?.url) setRevealed((current) => ({ ...current, [role]: String(body.url) }))
    setMessage(body?.message ?? (body?.tokenRevealed === false ? "O link já foi emitido. Rotacione para ver outro." : response.ok ? "Link atualizado." : "Não foi possível gerar o link."))
    setConfirmRole(null)
    await load()
  }

  const visibleRoles = roles.length > 0 ? roles : links.map((row) => row.attributionRole)
  const activeByRole = new Map(links.filter((row) => row.status === "active").map((row) => [row.attributionRole, row]))

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {visibleRoles.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum link disponível para esta conta.</p> : null}
        {visibleRoles.map((role) => {
          const row = activeByRole.get(role)
          const url = revealed[role]
          return (
            <section key={role} className="grid gap-2 rounded-lg border border-border/60 p-3" aria-label={ROLE_LABEL[role] ?? "Link"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{ROLE_LABEL[role] ?? "Link"}</h3>
                <span className="text-xs text-muted-foreground">{row ? `Ativo · ${row.useCount} indicação(ões)` : "Sem link ativo"}</span>
              </div>
              {url ? (
                <div className="grid gap-2">
                  <p className="break-all text-sm">{url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void navigator.clipboard.writeText(url)}>Copiar</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => {
                      const text = shareText(url)
                      if (navigator.share) void navigator.share({ title: "Tanto Telecom", text, url }).catch(() => navigator.clipboard.writeText(text))
                      else void navigator.clipboard.writeText(text)
                    }}>Compartilhar</Button>
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href={`https://wa.me/?text=${encodeURIComponent(shareText(url))}`} target="_blank" rel="noreferrer">WhatsApp</a>
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => download("indicacao.svg", new Blob([partnerQrSvg(url)], { type: "image/svg+xml" }))}>Baixar QR SVG</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void pngBlob(url).then((blob) => download("indicacao.png", blob))}>Baixar QR PNG</Button>
                  </div>
                </div>
              ) : null}
              {allowIssue ? (
                <div className="flex flex-wrap gap-2">
                  {!row ? <Button type="button" size="sm" onClick={() => void issue(role, "issue")}>Gerar link</Button> : null}
                  {row && confirmRole !== role ? <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRole(role)}>Rotacionar link</Button> : null}
                  {confirmRole === role ? (
                    <>
                      <Button type="button" size="sm" onClick={() => void issue(role, "rotate")}>Confirmar rotação</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRole(null)}>Cancelar</Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
        <p className="text-xs text-muted-foreground">O link completo aparece só na geração ou na rotação. O token anterior deixa de funcionar.</p>
        {message ? <p className="text-sm" role="status">{message}</p> : null}
      </CardContent>
    </Card>
  )
}
