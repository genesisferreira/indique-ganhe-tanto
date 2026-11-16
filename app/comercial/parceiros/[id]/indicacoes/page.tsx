"use client"

import { use } from "react"
import { PartnerReferrals } from "@/components/partner-merchants/admin-screens"

export default function ComercialParceiroIndicacoesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <PartnerReferrals id={id} />
}
