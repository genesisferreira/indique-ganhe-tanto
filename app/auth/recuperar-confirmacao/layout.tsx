import type { ReactNode } from "react"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default function RecoveryConfirmationLayout({
  children,
}: {
  children: ReactNode
}) {
  return children
}
