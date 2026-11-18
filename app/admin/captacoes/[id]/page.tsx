import { redirect } from "next/navigation"

export default async function AdminCaptacaoDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const raw = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") query.set(key, value)
  }
  const suffix = query.toString()
  redirect(suffix ? `/admin/indicacoes/${id}?${suffix}` : `/admin/indicacoes/${id}`)
}
