import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("funcionario self profile architecture", () => {
  const page = read("app/funcionario/perfil/page.tsx")
  const loader = read("lib/employees/self-profile.ts")
  const service = read("lib/employees/self-profile.service.ts")
  const sidebar = read("components/layout/sidebar.tsx")
  const admin = read("app/admin/perfil/page.tsx")
  const comercial = read("app/comercial/perfil/page.tsx")
  const indicador = read("app/indicador/perfil/page.tsx")

  it("A/O) rota e menu apontam para /funcionario/perfil", () => {
    assert.match(page, /loadFuncionarioSelfProfile/)
    assert.match(sidebar, /`\/\$\{variant\}\/perfil`/)
    assert.equal(page.includes("searchParams"), false)
  })

  it("I/J/K/L) não expõe salário, benefícios, comissões, tokens ou Auth IDs", () => {
    for (const src of [page, loader, service]) {
      assert.equal(/sal[aá]rio/i.test(src), false)
      assert.equal(/benef[ií]cio/i.test(src), false)
      assert.equal(/comiss/i.test(src), false)
      assert.equal(src.includes("service_role"), false)
      assert.equal(src.includes("access_token"), false)
      assert.equal(src.includes("auth_user_id"), false)
    }
  })

  it("serviço ignora ids de query e usa só a sessão", () => {
    assert.match(service, /sessionBoundProfileUserId/)
    assert.match(service, /\.eq\("profile_id", userId\)/)
    assert.equal(service.includes("searchParams"), false)
  })

  it("P) rotas de perfil admin/comercial/indicador permanecem", () => {
    assert.match(admin, /AdminPerfilPage|Meu Perfil/)
    assert.match(comercial, /PerfilComercialPage/)
    assert.match(indicador, /PerfilIndicadorPage/)
  })
})
