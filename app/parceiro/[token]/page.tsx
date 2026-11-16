"use client"

import { use } from "react"
import { PublicPartnerForm } from "@/components/partner-merchants/public-form"

export default function ParceiroPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <PublicPartnerForm token={token} />
}
