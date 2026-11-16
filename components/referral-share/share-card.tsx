"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { partnerQrMatrix, partnerQrSvg } from "@/lib/partner-merchants/qr-matrix"

type LinkRow = {
  linkId: string
  attributionRole: string
  status: string
  useCount: number
  campaign?: string | null
  publicDisplayName?: string
  createdAt?: string
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

function latestFor(role: string, links: LinkRow[]) {
  return links
    .filter((row) => row.attributionRole === role)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0]
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
  const [canRevoke, setCanRevoke] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [confirmRole, setConfirmRole] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
    setCanRevoke(mode === "admin" && body.canRevoke === true)
  }

  useEffect(() => { void load() }, [mode, originKind, originatorId])

  async function issue(role: string, actionMode: "issue" | "rotate") {
    if (busy) return
    setBusy(true)
    const endpoint = mode === "self" ? "/api/referral-share/mine" : "/api/admin/share-links"
    try {
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
    } finally {
      setBusy(false)
    }
  }

  async function revoke(role: string, linkId: string) {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch("/api/admin/share-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", idempotencyKey: newKey(), linkId, reason: "revogacao administrativa" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok === false) {
        setMessage(body?.message ?? "Não foi possível revogar o link.")
        return
      }
      setRevealed((current) => {
        const next = { ...current }
        delete next[role]
        return next
      })
      setConfirmRevoke(null)
      setMessage("Link revogado. Nenhum substituto foi criado.")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const visibleRoles = [...new Set([...roles, ...links.map((row) => row.attributionRole)])]

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {visibleRoles.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum link disponível para esta conta.</p> : null}
        {visibleRoles.map((role) => {
          const latest = latestFor(role, links)
          const active = latest?.status === "active" ? latest : undefined
          const url = active ? revealed[role] : undefined
          const statusText = active
            ? `Ativo · ${active.useCount} indicação(ões)`
            : latest?.status === "revoked"
              ? "Revogado"
              : "Sem link ativo"
          return (
            <section key={role} className="grid gap-2 rounded-lg border border-border/60 p-3" aria-label={ROLE_LABEL[role] ?? "Link"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{ROLE_LABEL[role] ?? "Link"}</h3>
                <span className="text-xs text-muted-foreground">{statusText}</span>
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
              {allowIssue || (canRevoke && active) ? (
                <div className="flex flex-wrap gap-2">
                  {allowIssue && !active ? <Button type="button" size="sm" disabled={busy} onClick={() => void issue(role, "issue")}>{latest?.status === "revoked" ? "Gerar novo link" : "Gerar link"}</Button> : null}
                  {allowIssue && active && confirmRole !== role ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setConfirmRevoke(null); setConfirmRole(role) }}>Rotacionar link</Button> : null}
                  {allowIssue && confirmRole === role ? (
                    <>
                      <Button type="button" size="sm" disabled={busy} onClick={() => void issue(role, "rotate")}>Confirmar rotação</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRole(null)}>Cancelar</Button>
                    </>
                  ) : null}
                  {canRevoke && active ? <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => { setConfirmRole(null); setConfirmRevoke(role) }}>Revogar link</Button> : null}
                </div>
              ) : null}
              <AlertDialog open={confirmRevoke === role} onOpenChange={(open) => { if (!open && !busy) setConfirmRevoke(null) }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revogar link</AlertDialogTitle>
                    <AlertDialogDescription>
                      O link e o QR deixarão de funcionar imediatamente. Nenhum link substituto será criado.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
                    <Button type="button" variant="destructive" disabled={busy} onClick={() => active && void revoke(role, active.linkId)}>
                      {busy ? "Revogando…" : "Confirmar revogação"}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          )
        })}
        <p className="text-xs text-muted-foreground">O link completo aparece só na geração ou na rotação. O token anterior deixa de funcionar.</p>
        {message ? <p className="text-sm" role="status">{message}</p> : null}
      </CardContent>
    </Card>
  )
}
