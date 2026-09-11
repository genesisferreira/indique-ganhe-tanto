import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applyGroupOpenChange,
  collapsibleNavTriggerAria,
  countExpandedNavGroups,
  defaultGroupOpenState,
  findNavGroupTitleForPathname,
  mergeStoredGroupOpenState,
  mergeUserGroupOpenState,
  navGroupPanelId,
  parseStoredGroupOpenState,
  resolveActiveNavHref,
  resolveDisplayGroupOpenState,
  safelyGetLocalStorageItem,
  safelySetLocalStorageItem,
  toggleGroupOpenState,
} from "@/lib/layout/collapsible-nav-groups"
import {
  adminNavGroupSpecs,
  filterNavGroups,
  shouldShowSidebarHref,
} from "@/lib/employees/admin-policy"
import { authorizeOperationalSectorAccess } from "@/lib/auth/sector-membership"

const repoRoot = process.cwd()
const adminGroups = adminNavGroupSpecs()

describe("sidebar A) grupo da rota ativa abre automaticamente", () => {
  it("abre Equipe em /admin/funcionarios e aninhados", () => {
    assert.equal(findNavGroupTitleForPathname(adminGroups, "/admin/funcionarios"), "Equipe")
    assert.equal(
      findNavGroupTitleForPathname(adminGroups, "/admin/funcionarios/abc"),
      "Equipe"
    )
  })
  it("não escolhe Dashboard /admin para rotas mais específicas", () => {
    assert.equal(findNavGroupTitleForPathname(adminGroups, "/admin"), "Visão geral")
    assert.equal(findNavGroupTitleForPathname(adminGroups, "/admin/planos"), "Gestão")
    assert.equal(
      findNavGroupTitleForPathname(adminGroups, "/admin/configuracoes/cobranca"),
      "Configurações"
    )
  })
  it("merge força o grupo ativo aberto", () => {
    const titles = adminGroups.map((group) => group.title)
    const state = mergeStoredGroupOpenState({
      stored: { Equipe: false, Financeiro: true },
      groupTitles: titles,
      activeTitle: "Equipe",
    })
    assert.equal(state.Equipe, true)
    assert.equal(state.Financeiro, true)
  })
})

describe("sidebar B) clicar no grupo expande/recolhe", () => {
  it("toggle inverte o estado", () => {
    const once = toggleGroupOpenState({ Comercial: false }, "Comercial")
    assert.equal(once.Comercial, true)
    assert.equal(toggleGroupOpenState(once, "Comercial").Comercial, false)
  })
})

describe("sidebar C) item ativo permanece visível", () => {
  it("href ativo mais específico continua o mesmo ao recolher outro grupo", () => {
    const hrefs = adminGroups.flatMap((group) => group.items.map((item) => item.href))
    const active = resolveActiveNavHref("/admin/funcionarios/xyz", hrefs)
    assert.equal(active, "/admin/funcionarios")
    const state = toggleGroupOpenState(
      defaultGroupOpenState(
        adminGroups.map((group) => group.title),
        "Equipe"
      ),
      "Financeiro"
    )
    assert.equal(state.Equipe, true)
    assert.equal(resolveActiveNavHref("/admin/funcionarios/xyz", hrefs), active)
  })
})

describe("sidebar D) grupos sem itens autorizados não aparecem", () => {
  it("filterNavGroups remove grupos vazios", () => {
    const groups = filterNavGroups(
      [
        { title: "Operação", items: [{ href: "/cobranca" }, { href: "/retencao" }] },
        { title: "Equipe", items: [{ href: "/admin/funcionarios" }] },
      ],
      { variant: "comercial", role: "comercial", membershipCodes: [] }
    )
    assert.equal(groups.some((group) => group.title === "Operação"), false)
    assert.equal(groups.some((group) => group.title === "Equipe"), true)
  })
})

describe("sidebar E) Cobrança condicionada à membership", () => {
  it("comercial sem collections não vê /cobranca", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/cobranca",
        variant: "comercial",
        role: "comercial",
        membershipCodes: ["commercial"],
      }),
      false
    )
  })
  it("comercial com collections vê /cobranca", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/cobranca",
        variant: "comercial",
        role: "comercial",
        membershipCodes: ["collections"],
      }),
      true
    )
  })
})

describe("sidebar F) Retenção condicionada à membership", () => {
  it("comercial sem retention não vê /retencao", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/retencao",
        variant: "comercial",
        role: "comercial",
        membershipCodes: ["commercial"],
      }),
      false
    )
  })
})

describe("sidebar G) Admin Master vê os grupos aplicáveis", () => {
  it("oito grupos na ordem esperada", () => {
    const groups = filterNavGroups(adminGroups, {
      variant: "admin",
      role: "admin_master",
      membershipCodes: [],
    })
    assert.deepEqual(
      groups.map((group) => group.title),
      [
        "Visão geral",
        "Comercial",
        "Operação",
        "Equipe",
        "Financeiro",
        "Gestão",
        "Integrações",
        "Configurações",
      ]
    )
  })
})

describe("sidebar H) Admin Consulta não ganha itens de escrita", () => {
  it("esconde pendentes e upload", () => {
    const groups = filterNavGroups(adminGroups, {
      variant: "admin",
      role: "admin_consulta",
      membershipCodes: [],
    })
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href))
    assert.equal(hrefs.includes("/admin/pagamentos-pendentes"), false)
    assert.equal(hrefs.includes("/admin/upload-comprovante"), false)
    assert.equal(hrefs.includes("/admin/financeiro"), true)
  })
})

describe("sidebar I) Financeiro não ganha módulos administrativos indevidos", () => {
  it("não inclui módulos futuros nem nova indicação comercial", () => {
    const groups = filterNavGroups(adminGroups, {
      variant: "admin",
      role: "admin_financeiro",
      membershipCodes: [],
    })
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href))
    assert.equal(hrefs.includes("/admin/vendas-internas"), false)
    assert.equal(hrefs.includes("/admin/comissoes"), false)
    assert.equal(hrefs.includes("/comercial/nova-indicacao"), false)
    assert.equal(hrefs.includes("/admin/pagamentos-pendentes"), true)
  })
})

describe("sidebar J) URLs antigas intactas", () => {
  it("preserva hrefs existentes", () => {
    const hrefs = adminGroups.flatMap((group) => group.items.map((item) => item.href))
    for (const href of [
      "/cobranca",
      "/retencao",
      "/admin/comerciais",
      "/admin/admins",
      "/admin/planos",
      "/admin/configuracoes",
      "/admin/configuracoes/cobranca",
      "/admin/funcionarios",
      "/admin/setores",
    ]) {
      assert.equal(hrefs.includes(href), true, href)
    }
  })
})

describe("sidebar K) acesso direto sem autorização continua bloqueado", () => {
  it("sem membership operacional 403", () => {
    const r = authorizeOperationalSectorAccess({
      sectorCode: "collections",
      action: "read",
      userId: "c1",
      profileId: "c1",
      role: "comercial",
      profileIsActive: true,
      employeeId: "e1",
      employeeStatus: "active",
      membershipActive: false,
      membershipSectorCode: null,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.status, 403)
  })
})

describe("sidebar L) menu baixo com grupos recolhidos", () => {
  it("padrão abre só o grupo ativo", () => {
    const titles = adminGroups.map((group) => group.title)
    const state = defaultGroupOpenState(titles, "Equipe")
    assert.equal(countExpandedNavGroups(state), 1)
    assert.equal(state.Equipe, true)
    assert.equal(state.Comercial, false)
  })
})

describe("sidebar componente reutilizável", () => {
  it("um único componente serve todos os shells", () => {
    const sidebar = readFileSync(join(repoRoot, "components/layout/sidebar.tsx"), "utf8")
    const widget = readFileSync(
      join(repoRoot, "components/layout/collapsible-nav-groups.tsx"),
      "utf8"
    )
    assert.match(sidebar, /CollapsibleNavGroups/)
    assert.equal(sidebar.includes("<CollapsibleNavGroups"), true)
    assert.match(widget, /aria-controls/)
    assert.match(widget, /aria-expanded=\{open\}/)
    assert.match(widget, /CollapsibleTrigger/)
    assert.match(widget, /localStorage/)
    assert.equal(navGroupPanelId("admin", "Visão geral").includes("visao-geral"), true)
  })
  it("JSON inválido de persistência é ignorado", () => {
    assert.equal(parseStoredGroupOpenState("{nope"), null)
    assert.deepEqual(parseStoredGroupOpenState('{"Equipe":true}'), { Equipe: true })
  })
})

describe("sidebar grupo ativo A–H", () => {
  const titles = adminGroups.map((group) => group.title)

  it("A) rota ativa abre seu grupo", () => {
    assert.equal(findNavGroupTitleForPathname(adminGroups, "/admin/funcionarios/abc"), "Equipe")
    const display = resolveDisplayGroupOpenState({ Equipe: false }, titles, "Equipe")
    assert.equal(display.Equipe, true)
  })

  it("B) estado persistido false não fecha grupo ativo", () => {
    const user = mergeUserGroupOpenState({
      stored: { Equipe: false, Gestão: true },
      groupTitles: titles,
    })
    const display = resolveDisplayGroupOpenState(user, titles, "Equipe")
    assert.equal(user.Equipe, false)
    assert.equal(display.Equipe, true)
    assert.equal(display.Gestão, true)
  })

  it("C) toggle não consegue deixar grupo ativo fechado", () => {
    const user = applyGroupOpenChange({
      userState: { Equipe: false, Financeiro: true },
      title: "Equipe",
      open: false,
      activeTitle: "Equipe",
    })
    assert.equal(user.Equipe, false)
    const display = resolveDisplayGroupOpenState(user, titles, "Equipe")
    assert.equal(display.Equipe, true)
  })

  it("D) item ativo permanece visível", () => {
    const hrefs = adminGroups.flatMap((group) => group.items.map((item) => item.href))
    assert.equal(resolveActiveNavHref("/admin/funcionarios/abc", hrefs), "/admin/funcionarios")
    const display = resolveDisplayGroupOpenState({ Equipe: false }, titles, "Equipe")
    assert.equal(display.Equipe, true)
  })

  it("E) grupo não ativo pode ser recolhido", () => {
    const user = applyGroupOpenChange({
      userState: { Financeiro: true, Equipe: false },
      title: "Financeiro",
      open: false,
      activeTitle: "Equipe",
    })
    assert.equal(user.Financeiro, false)
    const display = resolveDisplayGroupOpenState(user, titles, "Equipe")
    assert.equal(display.Financeiro, false)
    assert.equal(display.Equipe, true)
  })

  it("F) grupo não ativo pode ser expandido", () => {
    const user = applyGroupOpenChange({
      userState: { Financeiro: false },
      title: "Financeiro",
      open: true,
      activeTitle: "Equipe",
    })
    assert.equal(user.Financeiro, true)
    const display = resolveDisplayGroupOpenState(user, titles, "Equipe")
    assert.equal(display.Financeiro, true)
  })

  it("G) ao mudar a rota ativa, o novo grupo abre", () => {
    const user = { Equipe: false, Gestão: false }
    const fromFuncionarios = resolveDisplayGroupOpenState(user, titles, "Equipe")
    const fromPlanos = resolveDisplayGroupOpenState(user, titles, "Gestão")
    assert.equal(fromFuncionarios.Equipe, true)
    assert.equal(fromPlanos.Gestão, true)
  })

  it("H) grupo anterior volta a obedecer persistido", () => {
    const user = mergeUserGroupOpenState({
      stored: { Equipe: false, Gestão: false },
      groupTitles: titles,
    })
    const onEquipe = resolveDisplayGroupOpenState(user, titles, "Equipe")
    const onGestao = resolveDisplayGroupOpenState(user, titles, "Gestão")
    assert.equal(onEquipe.Equipe, true)
    assert.equal(onGestao.Equipe, false)
    assert.equal(onGestao.Gestão, true)
  })
})

describe("sidebar aria-expanded explícito", () => {
  it("contrato do trigger reflete aberto/fechado", () => {
    assert.deepEqual(collapsibleNavTriggerAria(true), { "aria-expanded": "true" })
    assert.deepEqual(collapsibleNavTriggerAria(false), { "aria-expanded": "false" })
    const widget = readFileSync(
      join(repoRoot, "components/layout/collapsible-nav-groups.tsx"),
      "utf8"
    )
    assert.match(widget, /aria-expanded=\{open\}/)
    assert.match(widget, /aria-expanded/)
  })
})

describe("sidebar localStorage indisponível", () => {
  it("leitura e escrita falham sem quebrar o estado de UI", () => {
    assert.equal(
      safelyGetLocalStorageItem(() => {
        throw new Error("blocked")
      }),
      null
    )
    assert.equal(
      safelySetLocalStorageItem(() => {
        throw new Error("quota")
      }, "{\"Equipe\":true}"),
      false
    )
    const display = resolveDisplayGroupOpenState({}, adminGroups.map((group) => group.title), "Equipe")
    assert.equal(display.Equipe, true)
  })
})

describe("sidebar fail-closed de memberships", () => {
  it("membershipCodes inicial vazio oculta Cobrança e Retenção no comercial", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/cobranca",
        variant: "comercial",
        role: "comercial",
        membershipCodes: [],
      }),
      false
    )
    assert.equal(
      shouldShowSidebarHref({
        href: "/retencao",
        variant: "comercial",
        role: "comercial",
        membershipCodes: [],
      }),
      false
    )
  })
  it("fetch falho (codes permanecem vazios) continua fail-closed", () => {
    const groups = filterNavGroups(
      [
        { title: "Operação", items: [{ href: "/cobranca" }, { href: "/retencao" }] },
        { title: "Comercial", items: [{ href: "/comercial/leads" }] },
      ],
      { variant: "comercial", role: "comercial", membershipCodes: [] }
    )
    assert.equal(groups.some((group) => group.title === "Operação"), false)
    assert.equal(groups.some((group) => group.title === "Comercial"), true)
  })
})

describe("sidebar nenhum módulo inexistente no catálogo admin", () => {
  it("não inclui Vendas Internas, Pós-venda, Upgrade, Técnico, Comissões, Financeiro de Funcionários", () => {
    const hrefs = adminGroups.flatMap((group) => group.items.map((item) => item.href)).join(" ")
    const labels = adminGroups.flatMap((group) => group.items.map((item) => item.label)).join(" ")
    const hay = `${hrefs} ${labels}`.toLowerCase()
    for (const forbidden of [
      "vendas-internas",
      "vendas internas",
      "pós-venda",
      "pos-venda",
      "upgrade",
      "técnico",
      "tecnico",
      "comissões",
      "comissoes",
      "financeiro de funcionários",
      "financeiro-de-funcionarios",
    ]) {
      assert.equal(hay.includes(forbidden), false, forbidden)
    }
  })
})
