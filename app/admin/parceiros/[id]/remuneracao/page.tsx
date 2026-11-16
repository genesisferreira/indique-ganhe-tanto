"use client"

import { use } from "react"
import { PartnerCompensation } from "@/components/partner-merchants/admin-screens"

export default function ParceiroRemuneracaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <PartnerCompensation id={id} />
}
