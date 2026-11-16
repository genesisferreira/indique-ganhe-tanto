"use client"

import { use } from "react"
import { PartnerDetail } from "@/components/partner-merchants/admin-screens"

export default function ComercialParceiroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <PartnerDetail id={id} basePath="/comercial/parceiros" showFinancial={false} />
}
