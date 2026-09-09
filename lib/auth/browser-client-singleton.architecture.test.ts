/**
 * Testes arquiteturais — hotfix/multiple-gotrueclient
 *
 * Prova que performClientLogout não reconstrói o browser client
 * (fix do warning "Multiple GoTrueClient instances detected").
 *
 * São testes estáticos de código-fonte; não necessitam browser nem
 * credenciais reais.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")

const logoutSrc = readFileSync(join(repoRoot, "lib/auth/logout.ts"), "utf8")
const clientSrc = readFileSync(join(repoRoot, "lib/supabase/client.ts"), "utf8")
const authProviderSrc = readFileSync(
  join(repoRoot, "components/auth/auth-provider.tsx"),
  "utf8"
)
const loginSrc = readFileSync(join(repoRoot, "app/login/page.tsx"), "utf8")
const primeiroAcessoSrc = readFileSync(
  join(repoRoot, "app/primeiro-acesso/page.tsx"),
  "utf8"
)
const cadastroSrc = readFileSync(join(repoRoot, "app/cadastro/page.tsx"), "utf8")

describe("browser client singleton — hotfix multiple-gotrueclient", () => {
  // ------------------------------------------------------------------
  // 1. performClientLogout NÃO chama resetSupabaseBrowserClient
  // ------------------------------------------------------------------
  it("1) performClientLogout NÃO reconstrói o browser client", () => {
    assert.ok(
      logoutSrc.includes("export async function performClientLogout"),
      "performClientLogout deve existir em lib/auth/logout.ts"
    )
    // A chamada a resetSupabaseBrowserClient foi REMOVIDA do logout.
    // Qualquer reintrodução fará este teste falhar.
    const usesReset = /resetSupabaseBrowserClient\s*\(/.test(logoutSrc)
    assert.equal(
      usesReset,
      false,
      "performClientLogout NÃO deve chamar resetSupabaseBrowserClient() — " +
        "isso causaria uma segunda GoTrueClient na mesma storageKey"
    )
  })

  // ------------------------------------------------------------------
  // 2. Import de resetSupabaseBrowserClient removido do logout
  // ------------------------------------------------------------------
  it("2) lib/auth/logout.ts não importa resetSupabaseBrowserClient", () => {
    const importsReset = logoutSrc.includes("resetSupabaseBrowserClient")
    assert.equal(
      importsReset,
      false,
      "lib/auth/logout.ts não deve importar resetSupabaseBrowserClient"
    )
  })

  // ------------------------------------------------------------------
  // 3. performClientLogout continua chamando signOut
  // ------------------------------------------------------------------
  it("3) performClientLogout ainda chama supabase.auth.signOut", () => {
    assert.match(
      logoutSrc,
      /supabase\.auth\.signOut/,
      "performClientLogout deve encerrar a sessão via signOut"
    )
  })

  // ------------------------------------------------------------------
  // 4. performClientLogout continua limpando o localStorage
  // ------------------------------------------------------------------
  it("4) performClientLogout ainda chama clearSupabaseLocalStorage", () => {
    assert.match(
      logoutSrc,
      /clearSupabaseLocalStorage\s*\(/,
      "performClientLogout deve limpar o localStorage de sessão Supabase"
    )
  })

  // ------------------------------------------------------------------
  // 5. getSupabaseClient exporta singleton de módulo
  // ------------------------------------------------------------------
  it("5) getSupabaseClient usa cache de módulo (singleton)", () => {
    assert.match(
      clientSrc,
      /let browserClient.*=.*null/,
      "client.ts deve declarar variável browserClient de módulo"
    )
    assert.match(
      clientSrc,
      /export function getSupabaseClient/,
      "getSupabaseClient deve ser exportada"
    )
    // Deve retornar o cache quando já existe
    assert.match(
      clientSrc,
      /if\s*\(!browserClient\s*\|\|/,
      "getSupabaseClient deve verificar cache antes de criar nova instância"
    )
  })

  // ------------------------------------------------------------------
  // 6. resetSupabaseBrowserClient permanece como utilitário (sem remoção)
  // ------------------------------------------------------------------
  it("6) resetSupabaseBrowserClient permanece em client.ts como utilitário", () => {
    assert.match(
      clientSrc,
      /export function resetSupabaseBrowserClient/,
      "resetSupabaseBrowserClient deve continuar exportada em client.ts"
    )
  })

  // ------------------------------------------------------------------
  // 7. AuthProvider usa getSupabaseClient (não cria client próprio)
  // ------------------------------------------------------------------
  it("7) AuthProvider usa getSupabaseClient — não cria browser client direto", () => {
    assert.match(
      authProviderSrc,
      /getSupabaseClient\s*\(/,
      "AuthProvider deve usar getSupabaseClient()"
    )
    assert.equal(
      authProviderSrc.includes("createBrowserClient"),
      false,
      "AuthProvider não deve chamar createBrowserClient diretamente"
    )
  })

  // ------------------------------------------------------------------
  // 8. Login usa getSupabaseClient (reusa instância existente)
  // ------------------------------------------------------------------
  it("8) login/page usa getSupabaseClient — não cria browser client direto", () => {
    assert.match(
      loginSrc,
      /getSupabaseClient\s*\(/,
      "login deve usar getSupabaseClient()"
    )
    assert.equal(
      loginSrc.includes("createBrowserClient"),
      false,
      "login não deve chamar createBrowserClient diretamente"
    )
  })

  // ------------------------------------------------------------------
  // 9. primeiro-acesso usa getSupabaseClient
  // ------------------------------------------------------------------
  it("9) primeiro-acesso usa getSupabaseClient — não cria browser client direto", () => {
    assert.match(
      primeiroAcessoSrc,
      /getSupabaseClient\s*\(/,
      "primeiro-acesso deve usar getSupabaseClient()"
    )
    assert.equal(
      primeiroAcessoSrc.includes("createBrowserClient"),
      false,
      "primeiro-acesso não deve chamar createBrowserClient diretamente"
    )
  })

  // ------------------------------------------------------------------
  // 10. Cadastro usa getSupabaseClient
  // ------------------------------------------------------------------
  it("10) cadastro usa getSupabaseClient — não cria browser client direto", () => {
    assert.match(
      cadastroSrc,
      /getSupabaseClient\s*\(/,
      "cadastro deve usar getSupabaseClient()"
    )
    assert.equal(
      cadastroSrc.includes("createBrowserClient"),
      false,
      "cadastro não deve chamar createBrowserClient diretamente"
    )
  })

  // ------------------------------------------------------------------
  // 11. Nenhum consumidor browser cria createBrowserClient diretamente
  //     fora de lib/supabase/client.ts
  // ------------------------------------------------------------------
  it("11) createBrowserClient só é chamado em lib/supabase/client.ts", () => {
    const sources: Array<{ name: string; src: string }> = [
      { name: "auth-provider", src: authProviderSrc },
      { name: "login", src: loginSrc },
      { name: "primeiro-acesso", src: primeiroAcessoSrc },
      { name: "cadastro", src: cadastroSrc },
      { name: "logout", src: logoutSrc },
    ]
    const violators = sources
      .filter((s) => s.src.includes("createBrowserClient"))
      .map((s) => s.name)

    assert.deepEqual(
      violators,
      [],
      `createBrowserClient deve existir SOMENTE em lib/supabase/client.ts. ` +
        `Violadores: ${violators.join(", ")}`
    )
  })

  // ------------------------------------------------------------------
  // 12. Regressão: logout.ts NÃO pode reintroduzir resetSupabaseBrowserClient
  //     (proteção explícita de nome de símbolo)
  // ------------------------------------------------------------------
  it("12) REGRESSÃO — logout.ts não deve mencionar resetSupabaseBrowserClient de nenhuma forma", () => {
    assert.equal(
      logoutSrc.includes("resetSupabaseBrowserClient"),
      false,
      "REGRESSÃO detectada: resetSupabaseBrowserClient foi reintroduzido em logout.ts — " +
        "isso causará o warning Multiple GoTrueClient instances"
    )
  })
})
