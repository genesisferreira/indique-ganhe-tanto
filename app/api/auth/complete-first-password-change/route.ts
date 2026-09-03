import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Limpa must_change_password somente para o auth.uid() da sessão.
 * Deve ser chamado DEPOIS de supabase.auth.updateUser({ password }) com sucesso.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, message: "Sessão não encontrada. Faça login novamente." },
      { status: 401 }
    )
  }

  const admin = await createAdminClient()
  const db = admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{
            data: { id: string; must_change_password: boolean | null } | null
            error: { message: string } | null
          }>
        }
      }
      update: (values: Record<string, unknown>) => {
        eq: (c: string, v: string) => {
          eq: (c2: string, v2: boolean) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: { id: string; must_change_password: boolean | null } | null
                error: { message: string } | null
              }>
            }
          }
        }
      }
    }
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, must_change_password")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json(
      { ok: false, message: "Perfil não encontrado." },
      { status: 404 }
    )
  }

  if (profile.must_change_password !== true) {
    return NextResponse.json({
      ok: true,
      alreadyCleared: true,
      message: "Nenhuma troca obrigatória pendente.",
    })
  }

  const { data: updated, error: updateError } = await db
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id)
    .eq("must_change_password", true)
    .select("id, must_change_password")
    .maybeSingle()

  if (updateError || !updated) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível concluir a troca de senha." },
      { status: 500 }
    )
  }

  if (updated.must_change_password !== false) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível confirmar a limpeza da flag." },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    alreadyCleared: false,
    message: "Senha atualizada. Acesso liberado.",
  })
}
