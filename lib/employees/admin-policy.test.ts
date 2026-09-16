import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  authorizeEmployeeAdminAccess,
  canDeactivateMembership,
  commercialMembershipDoesNotBypassLegacy,
  decideMembershipChange,
  shouldShowSidebarHref,
  stripEmployeeAdminBrowserActor,
  adminNavGroupSpecs,
  filterNavGroups,
  isLegacyCommercialSector,
  presentSectorMembershipLabel,
  LEGACY_COMMERCIAL_MEMBERSHIP_LABEL,
  LEGACY_COMMERCIAL_MEMBERSHIP_WARNING,
  LEGACY_COMMERCIAL_SECTOR_CODE,
  ADMIN_SECTORS_VISIBLE_COLUMNS,
} from "@/lib/employees/admin-policy"
import { isEligibleForFutureAssignment, hasSector } from "@/lib/employees/foundation"
import { authorizeOperationalSectorAccess } from "@/lib/auth/sector-membership"
import { isCommercialEmployeeAssignmentEligible } from "@/lib/employees/foundation"

const repoRoot = process.cwd()

function readSrc(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8")
}

describe("A) Admin Master lista funcionários", () => {
  it("master lê e escreve", () => {
    const r = authorizeEmployeeAdminAccess({
      userId: "u1",
      profileId: "u1",
      role: "admin_master",
      action: "read",
    })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.canWrite, true)
  })
})

describe("B) funcionário pode possuir 2+ setores", () => {
  it("commercial + collections ativos", () => {
    const memberships = [
      { sectorCode: "commercial", isActive: true },
      { sectorCode: "collections", isActive: true },
    ]
    assert.equal(hasSector({ memberships, sectorCode: "commercial" }), true)
    assert.equal(hasSector({ memberships, sectorCode: "collections" }), true)
  })
})

describe("C) duplicate active membership rejeitada", () => {
  it("segunda ativa no mesmo setor", () => {
    const d = decideMembershipChange({
      existing: [{ id: "m1", isActive: true }],
      wantActive: true,
    })
    assert.equal(d.action, "reject_duplicate")
  })
})

describe("D) adicionar collections funciona", () => {
  it("insert quando não há membership", () => {
    const d = decideMembershipChange({ existing: [], wantActive: true })
    assert.equal(d.action, "insert")
  })
})

describe("E) adicionar retention funciona", () => {
  it("reactiva histórico em vez de apagar", () => {
    const d = decideMembershipChange({
      existing: [{ id: "old", isActive: false, updatedAt: "2026-01-01" }],
      wantActive: true,
    })
    assert.equal(d.action, "activate")
    if (d.action === "activate") assert.equal(d.membershipId, "old")
  })
})

describe("F–I) employee não active não fica elegível", () => {
  for (const status of ["paused", "vacation", "away", "dismissed"] as const) {
    it(status, () => {
      assert.equal(
        isEligibleForFutureAssignment({ employeeStatus: status, membershipActive: true }),
        false
      )
    })
  }
})

describe("J) reativação preserva histórico", () => {
  it("usa membership existente inativa", () => {
    const d = decideMembershipChange({
      existing: [
        { id: "hist-1", isActive: false, updatedAt: "2026-01-01" },
        { id: "hist-2", isActive: false, updatedAt: "2026-06-01" },
      ],
      wantActive: true,
    })
    assert.equal(d.action, "activate")
    if (d.action === "activate") assert.equal(d.membershipId, "hist-2")
  })
})

describe("K) funcionário comum não administra", () => {
  it("comercial write 403", () => {
    const r = authorizeEmployeeAdminAccess({
      userId: "c1",
      profileId: "c1",
      role: "comercial",
      action: "write",
    })
    assert.equal(r.ok, false)
  })
  it("indicador read 403", () => {
    const r = authorizeEmployeeAdminAccess({
      userId: "i1",
      profileId: "i1",
      role: "indicador",
      action: "read",
    })
    assert.equal(r.ok, false)
  })
})

describe("L) commercial não ganha bypass indevido", () => {
  it("membership sozinha não deixa a fila pronta", () => {
    const r = commercialMembershipDoesNotBypassLegacy({
      profileRole: "comercial",
      hasCommercialLeadSettings: false,
    })
    assert.equal(r.bypassesLegacy, false)
    assert.equal(r.commercialDistributionReady, false)
  })
  it("role indicador + membership não distribui", () => {
    const r = commercialMembershipDoesNotBypassLegacy({
      profileRole: "indicador",
      hasCommercialLeadSettings: true,
    })
    assert.equal(r.commercialDistributionReady, false)
  })
  it("2.1B continua exigindo role comercial", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "comercial",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      true
    )
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "admin_master",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      false
    )
  })
})

describe("M) Cobrança continua usando assignment engine", () => {
  it("sync ainda chama ensureCollectionAssignment", () => {
    const persist = readSrc("lib/collections/discovery-persist-ops.ts")
    const sync = readSrc("lib/collections/sync.ts")
    assert.match(persist, /ensureCollectionAssignment/)
    assert.match(sync, /createOpsDiscoveryCaseRepo/)
  })
})

describe("N) Retenção continua search-and-attend", () => {
  it("search não usa round-robin", () => {
    const src = readSrc("lib/retention/search.ts")
    assert.equal(src.includes("assignSectorWorkItem"), false)
    assert.equal(src.includes("assign_sector_work_item"), false)
  })
  it("attendance não exige assignment", () => {
    const src = readSrc("lib/retention/attendance.service.ts")
    assert.equal(src.includes("sector_work_assignments"), false)
  })
})

describe("O) actor browser é ignorado", () => {
  it("remove actor/role spoof e preserva sectorCode do formulário", () => {
    const rest = stripEmployeeAdminBrowserActor({
      actorProfileId: "spoof",
      role: "admin_master",
      sectorCode: "collections",
      active: true,
    })
    assert.equal(rest.actorProfileId, undefined)
    assert.equal(rest.role, undefined)
    assert.equal(rest.sectorCode, "collections")
  })
})

describe("P) UUID não aparece como requisito normal da UI", () => {
  it("lista e edição não pedem UUID", () => {
    const list = readSrc("app/admin/funcionarios/page.tsx")
    const edit = readSrc("app/admin/funcionarios/[id]/page.tsx")
    const create = readSrc("app/admin/funcionarios/novo/page.tsx")
    for (const src of [list, edit, create]) {
      assert.equal(src.includes("employee_id destino"), false)
      assert.equal(/placeholder=["']uuid/i.test(src), false)
    }
  })
})

describe("Q) remoção com assignment ativa é bloqueada", () => {
  it("count > 0", () => {
    const r = canDeactivateMembership(2)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, "active_assignments")
  })
  it("count 0 libera", () => {
    assert.equal(canDeactivateMembership(0).ok, true)
  })
})

describe("R) legacy Commercial continua funcionando", () => {
  it("serviço admin não escreve role nem lead settings", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.match(src, /commercial_lead_settings/)
    assert.equal(/from\("commercial_lead_settings"[\s\S]{0,80}\.insert\(/.test(src), false)
    assert.equal(/from\("profiles"\)[\s\S]{0,280}role:/.test(src), false)
    assert.equal(src.includes("createUser"), false)
    assert.equal(src.includes("syncCollectionsFromControllr"), false)
  })
})

describe("consulta e financeiro", () => {
  it("consulta lê e não escreve", () => {
    const read = authorizeEmployeeAdminAccess({
      userId: "a",
      profileId: "a",
      role: "admin_consulta",
      action: "read",
    })
    const write = authorizeEmployeeAdminAccess({
      userId: "a",
      profileId: "a",
      role: "admin_consulta",
      action: "write",
    })
    assert.equal(read.ok, true)
    assert.equal(write.ok, false)
  })
  it("financeiro não altera funcionários", () => {
    const write = authorizeEmployeeAdminAccess({
      userId: "f",
      profileId: "f",
      role: "admin_financeiro",
      action: "write",
    })
    assert.equal(write.ok, false)
  })
})

describe("menu A) Admin Master vê menu completo aplicável", () => {
  it("contém funcionários, comerciais, cobranca e financeiro", () => {
    const groups = filterNavGroups(adminNavGroupSpecs(), {
      variant: "admin",
      role: "admin_master",
      membershipCodes: [],
    })
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    for (const href of [
      "/admin/funcionarios",
      "/admin/comerciais",
      "/admin/admins",
      "/admin/setores",
      "/cobranca",
      "/retencao",
      "/admin/financeiro",
      "/admin/configuracoes/cobranca",
    ]) {
      assert.equal(hrefs.includes(href), true, href)
    }
  })
})

describe("menu B/C) commercial sem collections/retention não vê módulos", () => {
  it("sem collections esconde Cobrança", () => {
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
  it("sem retention esconde Retenção", () => {
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

describe("menu D–F) membership operacional mostra o módulo", () => {
  it("collections vê Cobrança", () => {
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
  it("retention vê Retenção", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/retencao",
        variant: "comercial",
        role: "comercial",
        membershipCodes: ["retention"],
      }),
      true
    )
  })
  it("ambos vêem ambos", () => {
    const codes = ["collections", "retention"]
    assert.equal(
      shouldShowSidebarHref({
        href: "/cobranca",
        variant: "comercial",
        role: "comercial",
        membershipCodes: codes,
      }),
      true
    )
    assert.equal(
      shouldShowSidebarHref({
        href: "/retencao",
        variant: "comercial",
        role: "comercial",
        membershipCodes: codes,
      }),
      true
    )
  })
})

describe("menu G/H) esconder link não altera proteção da rota", () => {
  it("sem membership continua 403 na autorização server-side", () => {
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

describe("menu I/N) URLs antigas preservadas no menu", () => {
  it("rotas existentes continuam", () => {
    const hrefs = adminNavGroupSpecs().flatMap((g) => g.items.map((i) => i.href))
    for (const href of [
      "/cobranca",
      "/retencao",
      "/admin/comerciais",
      "/admin/admins",
      "/admin/planos",
      "/admin/configuracoes",
      "/admin/configuracoes/cobranca",
    ]) {
      assert.equal(hrefs.includes(href), true, href)
    }
  })
})

describe("menu J) financeiro não some para quem já tinha autorização", () => {
  it("admin_financeiro vê recompensas e pendentes", () => {
    const groups = filterNavGroups(adminNavGroupSpecs(), {
      variant: "admin",
      role: "admin_financeiro",
      membershipCodes: [],
    })
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    assert.equal(hrefs.includes("/admin/financeiro"), true)
    assert.equal(hrefs.includes("/admin/pagamentos-pendentes"), true)
  })
  it("consulta não vê ações financeiras", () => {
    const groups = filterNavGroups(adminNavGroupSpecs(), {
      variant: "admin",
      role: "admin_consulta",
      membershipCodes: [],
    })
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    assert.equal(hrefs.includes("/admin/pagamentos-pendentes"), false)
    assert.equal(hrefs.includes("/admin/financeiro"), true)
  })
})

describe("menu K/L/M) telas legadas e config cobrança", () => {
  it("comerciais, administradores e config cobrança no menu master", () => {
    const hrefs = adminNavGroupSpecs().flatMap((g) => g.items.map((i) => i.href))
    assert.equal(hrefs.includes("/admin/comerciais"), true)
    assert.equal(hrefs.includes("/admin/admins"), true)
    assert.equal(hrefs.includes("/admin/configuracoes/cobranca"), true)
  })
})

describe("3.1D-B A) commercial continua membership válida", () => {
  it("hasSector reconhece commercial ativo", () => {
    assert.equal(
      hasSector({
        memberships: [{ sectorCode: LEGACY_COMMERCIAL_SECTOR_CODE, isActive: true }],
        sectorCode: "commercial",
      }),
      true
    )
  })
  it("ativar commercial usa o mesmo decideMembershipChange", () => {
    assert.equal(decideMembershipChange({ existing: [], wantActive: true }).action, "insert")
  })
})

describe("3.1D-B B) commercial é identificado como legado na apresentação", () => {
  it("label distinto dos setores operacionais", () => {
    assert.equal(isLegacyCommercialSector("commercial"), true)
    assert.equal(isLegacyCommercialSector("collections"), false)
    assert.equal(isLegacyCommercialSector("retention"), false)
    assert.equal(
      presentSectorMembershipLabel({ code: "commercial", name: "Comercial" }),
      LEGACY_COMMERCIAL_MEMBERSHIP_LABEL
    )
    assert.equal(
      presentSectorMembershipLabel({ code: "collections", name: "Cobrança" }),
      "Cobrança"
    )
  })
  it("aviso legado está na tela de edição antes da alteração", () => {
    const src = readSrc("app/admin/funcionarios/[id]/page.tsx")
    assert.match(src, /LEGACY_COMMERCIAL_MEMBERSHIP_WARNING/)
    assert.match(src, /presentSectorMembershipLabel/)
    assert.match(src, /isLegacyCommercialSector/)
    assert.equal(src.includes("não habilita sozinha a fila Comercial"), true)
    assert.equal(LEGACY_COMMERCIAL_MEMBERSHIP_WARNING.includes("não habilita sozinho"), true)
  })
})

describe("3.1D-B C–E) marcar commercial não cria legado 2.1B", () => {
  it("C) não altera profiles.role", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(src.includes('role: "comercial"'), false)
    assert.equal(/update\(\{[\s\S]{0,120}role:/.test(src), false)
  })
  it("D) não cria commercial_lead_settings", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(/from\("commercial_lead_settings"[\s\S]{0,120}\.insert\(/.test(src), false)
  })
  it("E) não cria commercial_availability", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(src.includes("commercial_availability"), false)
  })
})

describe("3.1D-B F) motor Comercial 2.1B não é alterado", () => {
  it("elegibilidade ainda exige role comercial + employee + membership", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "comercial",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      true
    )
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "indicador",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      false
    )
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "funcionario",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      false
    )
    const warning = commercialMembershipDoesNotBypassLegacy({
      profileRole: "indicador",
      hasCommercialLeadSettings: false,
    })
    assert.equal(warning.bypassesLegacy, false)
    assert.equal(warning.commercialDistributionReady, false)
  })
  it("serviço admin não chama pick/assign comercial", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(src.includes("pick_next_available_commercial"), false)
    assert.equal(src.includes("assign_referral_to_next_commercial"), false)
  })
})

describe("3.1D-B G) collections continua normal", () => {
  it("label operacional e insert de membership", () => {
    assert.equal(isLegacyCommercialSector("collections"), false)
    assert.equal(
      presentSectorMembershipLabel({ code: "collections", name: "Cobrança" }),
      "Cobrança"
    )
    assert.equal(decideMembershipChange({ existing: [], wantActive: true }).action, "insert")
  })
  it("sync de cobrança permanece no motor 2.2", () => {
    const persist = readSrc("lib/collections/discovery-persist-ops.ts")
    const sync = readSrc("lib/collections/sync.ts")
    assert.match(persist, /ensureCollectionAssignment/)
    assert.match(sync, /createOpsDiscoveryCaseRepo/)
  })
})

describe("3.1D-B H) retention continua normal", () => {
  it("label operacional", () => {
    assert.equal(isLegacyCommercialSector("retention"), false)
    assert.equal(
      presentSectorMembershipLabel({ code: "retention", name: "Retenção" }),
      "Retenção"
    )
  })
  it("search-and-attend sem round-robin", () => {
    const search = readSrc("lib/retention/search.ts")
    const attendance = readSrc("lib/retention/attendance.service.ts")
    assert.equal(search.includes("assign_sector_work_item"), false)
    assert.equal(attendance.includes("sector_work_assignments"), false)
  })
})

describe("3.1D-B I) código do setor aparece na apresentação de /admin/setores", () => {
  it("modelo de colunas inclui Código", () => {
    const headers = ADMIN_SECTORS_VISIBLE_COLUMNS.map((col) => col.header)
    assert.deepEqual(headers, ["Nome", "Código", "Descrição", "Situação", "Membros ativos"])
  })
  it("página renderiza a coluna código", () => {
    const src = readSrc("app/admin/setores/page.tsx")
    assert.match(src, /ADMIN_SECTORS_VISIBLE_COLUMNS/)
    assert.match(src, /item\.code/)
    assert.equal(src.includes("header: \"Setor\""), false)
  })
})

describe("3.1D-B J) /admin/setores continua read-only", () => {
  it("rota só expõe GET e canWrite false", () => {
    const src = readSrc("app/api/admin/sectors/route.ts")
    assert.match(src, /export async function GET/)
    assert.equal(src.includes("export async function POST"), false)
    assert.equal(src.includes("export async function PATCH"), false)
    assert.equal(src.includes("export async function PUT"), false)
    assert.equal(src.includes("export async function DELETE"), false)
    assert.match(src, /canWrite:\s*false/)
  })
  it("página não envia mutação", () => {
    const src = readSrc("app/admin/setores/page.tsx")
    assert.equal(/method:\s*["']POST["']/.test(src), false)
    assert.equal(/method:\s*["']PATCH["']/.test(src), false)
    assert.equal(/method:\s*["']DELETE["']/.test(src), false)
  })
})

describe("3.1D-B K) permissões Admin Master/Consulta/Financeiro", () => {
  it("master escreve; consulta e financeiro só leem", () => {
    const master = authorizeEmployeeAdminAccess({
      userId: "m",
      profileId: "m",
      role: "admin_master",
      action: "write",
    })
    const consultaWrite = authorizeEmployeeAdminAccess({
      userId: "c",
      profileId: "c",
      role: "admin_consulta",
      action: "write",
    })
    const financeiroWrite = authorizeEmployeeAdminAccess({
      userId: "f",
      profileId: "f",
      role: "admin_financeiro",
      action: "write",
    })
    const financeiroRead = authorizeEmployeeAdminAccess({
      userId: "f",
      profileId: "f",
      role: "admin_financeiro",
      action: "read",
    })
    assert.equal(master.ok, true)
    if (master.ok) assert.equal(master.canWrite, true)
    assert.equal(consultaWrite.ok, false)
    assert.equal(financeiroWrite.ok, false)
    assert.equal(financeiroRead.ok, true)
    if (financeiroRead.ok) assert.equal(financeiroRead.canWrite, false)
  })
})

describe("3.1D-B L) URLs antigas continuam no menu", () => {
  it("cobranca, retencao, comerciais, admins, planos, configs", () => {
    const hrefs = adminNavGroupSpecs().flatMap((g) => g.items.map((i) => i.href))
    for (const href of [
      "/cobranca",
      "/retencao",
      "/admin/comerciais",
      "/admin/admins",
      "/admin/planos",
      "/admin/configuracoes",
      "/admin/configuracoes/cobranca",
    ]) {
      assert.equal(hrefs.includes(href), true, href)
    }
    assert.equal(hrefs.includes("/admin/vendas-internas"), false)
  })
})

describe("3.1D-B M) nenhuma migration/SQL nova", () => {
  it("arquivos da gestão de funcionários não incluem SQL", () => {
    for (const rel of [
      "lib/employees/admin.service.ts",
      "lib/employees/admin-policy.ts",
      "app/api/admin/employees/route.ts",
      "app/api/admin/sectors/route.ts",
      "app/admin/setores/page.tsx",
    ]) {
      assert.equal(rel.endsWith(".sql"), false)
    }
    const supabase = join(repoRoot, "supabase")
    const sqlNames = existsSync(supabase)
      ? readdirSync(supabase).filter((name) => name.endsWith(".sql") && name.includes("3-1d"))
      : []
    assert.deepEqual(sqlNames, [])
    const service = readSrc("lib/employees/admin.service.ts")
    assert.equal(service.includes("auth.admin.createUser"), false)
  })
})

describe("3.1D-B N) nenhum fluxo Controllr executado", () => {
  it("serviço admin não chama sync/createInterest", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(src.includes("syncCollectionsFromControllr"), false)
    assert.equal(src.includes("createInterest"), false)
    assert.equal(src.includes("controllr"), false)
    assert.equal(src.includes("brbyte"), false)
  })
})
