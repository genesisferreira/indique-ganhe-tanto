"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth/auth-provider"

export default function ContaInativaPage() {
  const auth = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">Conta inativa</h1>
        <p className="text-muted-foreground">
          Este acesso está desativado. Se você acredita que isso é um engano, fale com o
          administrador.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => {
              void auth.signOut()
            }}
          >
            Encerrar sessão
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Ir para o login</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
