import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
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
    const src = readSrc("lib/collections/sync.ts")
    assert.match(src, /ensureCollectionAssignment/)
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
    assert.equal(/from\("profiles"\)[\s\S]{0,200}\.update\(/.test(src), false)
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
