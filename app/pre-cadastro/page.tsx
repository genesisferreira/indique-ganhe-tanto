import { Suspense } from "react"
import { notFound } from "next/navigation"
import { PreCadastroForm } from "@/components/public/pre-cadastro-form"
import { AppToaster } from "@/components/notifications/app-toaster"
import { isPublicPreRegistrationEnabled } from "@/lib/public-pre-registration/config"

export const dynamic = "force-dynamic"

export default function PreCadastroPage() {
  if (!isPublicPreRegistrationEnabled()) {
    notFound()
  }

  return (
    <>
      <AppToaster />
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center text-muted-foreground">
            Carregando…
          </div>
        }
      >
        <PreCadastroForm />
      </Suspense>
    </>
  )
}
