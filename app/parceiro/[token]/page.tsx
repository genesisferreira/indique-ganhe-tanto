"use client"

import { use } from "react"
import { ReferralSharePublicForm } from "@/components/referral-share/public-form"

export default function ParceiroPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <ReferralSharePublicForm token={token} />
}
