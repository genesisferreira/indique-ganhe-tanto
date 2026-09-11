import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  authorizeOperationalSectorAccess,
  membershipGrantsAdminRoute,
} from "@/lib/auth/sector-membership"
import {
  evaluateRouteAccessForRole,
  getDashboardHomeForRole,
  isAllowedDuringMustChangePassword,
  isProfileInactive,
  isRoleAllowedOnDashboardVariant,
  resolvePostAuthPath,
} from "@/lib/auth/auth-audit"
import {
  dashboardVariantForRole,
  operationalShellVariantForRole,
} from "@/lib/auth/dashboard-variant"
import { isCommercialEmployeeAssignmentEligible } from "@/lib/employees/foundation"
import {
  filterNavGroups,
  funcionarioNavGroupSpecs,
  shouldShowSidebarHref,
  authorizeEmployeeAdminAccess,
} from "@/lib/employees/admin-policy"
import {
  passwordResetPublicMessage,
  sanitizePasswordRecoveryNextPath,
} from "@/lib/auth/password-reset"
import { shouldInactivateProfileOnEmployeeStatus } from "@/lib/auth/account-lifecycle"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")

function readSrc(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8")
}

const funcionarioMember = {
  sectorCode: "collections" as const,
  userId: "u-fn",
  profileId: "u-fn",
  role: "funcionario" as const,
  profileIsActive: true,
  employeeId: "e-fn",
  employeeStatus: "active",
  membershipActive: true,
  membershipSectorCode: "collections",
}

describe("3.1E-A A) funcionario não é admin", () => {
  it("não lê/escreve admin de funcionários", () => {
    const read = authorizeEmployeeAdminAccess({
      userId: "u-fn",
      profileId: "u-fn",
      role: "funcionario",
      action: "read",
    })
    const write = authorizeEmployeeAdminAccess({
      userId: "u-fn",
      profileId: "u-fn",
      role: "funcionario",
      action: "write",
    })
    assert.equal(read.ok, false)
    assert.equal(write.ok, false)
  })

  it("não acessa /admin", () => {
    assert.equal(evaluateRouteAccessForRole("/admin", "funcionario").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/admin/funcionarios", "funcionario").allowed, false)
  })
})

describe("3.1E-A B) membership não concede /admin", () => {
  it("helper continua false", () => {
    assert.equal(membershipGrantsAdminRoute("collections"), false)
    assert.equal(membershipGrantsAdminRoute("retention"), false)
  })
})

describe("3.1E-A C/D) Cobrança por membership", () => {
  it("C) funcionario active + collections permitido", () => {
    const auth = authorizeOperationalSectorAccess({
      ...funcionarioMember,
      action: "read",
    })
    assert.equal(auth.ok, true)
    assert.equal(evaluateRouteAccessForRole("/cobranca", "funcionario").allowed, true)
  })

  it("D) sem collections negado", () => {
    const auth = authorizeOperationalSectorAccess({
      ...funcionarioMember,
      membershipActive: false,
      membershipSectorCode: null,
      action: "read",
    })
    assert.equal(auth.ok, false)
  })
})

describe("3.1E-A E/F) Retenção por membership", () => {
  it("E) retention permitido", () => {
    const auth = authorizeOperationalSectorAccess({
      ...funcionarioMember,
      sectorCode: "retention",
      membershipSectorCode: "retention",
      action: "read",
    })
    assert.equal(auth.ok, true)
    assert.equal(evaluateRouteAccessForRole("/retencao", "funcionario").allowed, true)
  })

  it("F) collections não autoriza retenção", () => {
    const auth = authorizeOperationalSectorAccess({
      ...funcionarioMember,
      sectorCode: "retention",
      membershipSectorCode: "collections",
      action: "write",
    })
    assert.equal(auth.ok, false)
  })
})

describe("3.1E-A G–J) employee não active bloqueado", () => {
  for (const status of ["paused", "vacation", "away", "dismissed"] as const) {
    it(`${status} nega operação`, () => {
      const auth = authorizeOperationalSectorAccess({
        ...funcionarioMember,
        employeeStatus: status,
        action: "write",
      })
      assert.equal(auth.ok, false)
    })
  }
})

describe("3.1E-A K) profile inactive bloqueia", () => {
  it("isProfileInactive e authorize", () => {
    assert.equal(isProfileInactive(false), true)
    assert.equal(isProfileInactive(true), false)
    const auth = authorizeOperationalSectorAccess({
      ...funcionarioMember,
      profileIsActive: false,
      action: "read",
    })
    assert.equal(auth.ok, false)
    assert.equal(
      resolvePostAuthPath({
        role: "funcionario",
        mustChangePassword: false,
        isActive: false,
      }),
      "/conta-inativa"
    )
  })
})

describe("3.1E-A L) comercial legado inalterado no prefixo", () => {
  it("comercial continua em /comercial e /cobranca", () => {
    assert.equal(evaluateRouteAccessForRole("/comercial", "comercial").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/cobranca", "comercial").allowed, true)
    assert.equal(operationalShellVariantForRole("comercial"), "comercial")
  })
})

describe("3.1E-A M) funcionario + commercial não ativa 2.1B", () => {
  it("elegibilidade comercial exige role comercial", () => {
    assert.equal(
      isCommercialEmployeeAssignmentEligible({
        profileRole: "funcionario",
        profileIsActive: true,
        employeeStatus: "active",
        hasActiveCommercialMembership: true,
      }),
      false
    )
  })
})

describe("3.1E-A N) regras admin preservadas", () => {
  it("consulta lê, financeiro lê, master escreve funcionários", () => {
    assert.equal(
      authorizeEmployeeAdminAccess({
        userId: "a",
        profileId: "a",
        role: "admin_consulta",
        action: "read",
      }).ok,
      true
    )
    assert.equal(
      authorizeEmployeeAdminAccess({
        userId: "a",
        profileId: "a",
        role: "admin_consulta",
        action: "write",
      }).ok,
      false
    )
    assert.equal(
      authorizeEmployeeAdminAccess({
        userId: "a",
        profileId: "a",
        role: "admin_financeiro",
        action: "write",
      }).ok,
      false
    )
    const master = authorizeEmployeeAdminAccess({
      userId: "a",
      profileId: "a",
      role: "admin_master",
      action: "write",
    })
    assert.equal(master.ok, true)
  })

  it("consulta/financeiro não escrevem no setor mesmo com membership", () => {
    assert.equal(
      authorizeOperationalSectorAccess({
        ...funcionarioMember,
        role: "admin_consulta",
        action: "write",
      }).ok,
      false
    )
    assert.equal(
      authorizeOperationalSectorAccess({
        ...funcionarioMember,
        role: "admin_financeiro",
        action: "write",
      }).ok,
      false
    )
  })
})

describe("3.1E-A O) sidebar funcionario filtra memberships", () => {
  it("só Cobrança quando collections", () => {
    const groups = filterNavGroups(funcionarioNavGroupSpecs(), {
      variant: "funcionario",
      role: "funcionario",
      membershipCodes: ["collections"],
    })
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    assert.equal(hrefs.includes("/cobranca"), true)
    assert.equal(hrefs.includes("/retencao"), false)
    assert.equal(groups.some((g) => g.title === "Operação"), true)
  })

  it("grupo Operação some sem memberships", () => {
    const groups = filterNavGroups(funcionarioNavGroupSpecs(), {
      variant: "funcionario",
      role: "funcionario",
      membershipCodes: [],
    })
    assert.equal(groups.some((g) => g.title === "Operação"), false)
    assert.equal(
      shouldShowSidebarHref({
        href: "/cobranca",
        variant: "funcionario",
        role: "funcionario",
        membershipCodes: [],
      }),
      false
    )
  })
})

describe("3.1E-A P) fail-closed", () => {
  it("href desconhecido no shell funcionario é oculto", () => {
    assert.equal(
      shouldShowSidebarHref({
        href: "/admin",
        variant: "funcionario",
        role: "funcionario",
        membershipCodes: ["collections", "retention"],
      }),
      false
    )
  })
})

describe("3.1E-A Q) primeiro-acesso aceita funcionario", () => {
  it("rota e home", () => {
    assert.equal(evaluateRouteAccessForRole("/primeiro-acesso", "funcionario").allowed, true)
    assert.equal(isAllowedDuringMustChangePassword("/primeiro-acesso"), true)
    assert.equal(getDashboardHomeForRole("funcionario"), "/funcionario")
    assert.equal(dashboardVariantForRole("funcionario"), "funcionario")
    assert.equal(isRoleAllowedOnDashboardVariant("funcionario", "funcionario"), true)
    assert.equal(isRoleAllowedOnDashboardVariant("comercial", "funcionario"), false)
    assert.equal(isRoleAllowedOnDashboardVariant("admin", "funcionario"), false)
    assert.equal(
      resolvePostAuthPath({
        role: "funcionario",
        mustChangePassword: true,
        isActive: true,
      }),
      "/primeiro-acesso"
    )
  })
})

describe("3.1E-A R) password reset não revela e-mail", () => {
  it("mensagem neutra e next sanitizado", () => {
    assert.match(passwordResetPublicMessage(), /Se o e-mail estiver cadastrado/i)
    assert.equal(sanitizePasswordRecoveryNextPath("https://evil.example"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath("/login"), "/atualizar-senha")
    assert.equal(sanitizePasswordRecoveryNextPath("/atualizar-senha"), "/atualizar-senha")
    const page = readSrc("app/recuperar-senha/page.tsx")
    assert.match(page, /resetPasswordForEmail/)
    assert.equal(page.includes("service_role"), false)
    assert.equal(page.includes("createServiceRoleClient"), false)
    assert.match(page, /passwordResetPublicMessage|Se o e-mail estiver cadastrado/)
  })
})

describe("3.1E-A S) URLs antigas preservadas", () => {
  it("rotas conhecidas continuam reconhecidas", () => {
    for (const path of [
      "/admin/comerciais",
      "/admin/admins",
      "/admin/planos",
      "/admin/configuracoes",
      "/admin/configuracoes/cobranca",
      "/cobranca",
      "/retencao",
      "/comercial",
      "/indicador",
    ]) {
      const admin = evaluateRouteAccessForRole(path, "admin_master")
      assert.equal(typeof admin.allowed, "boolean", path)
    }
    assert.equal(evaluateRouteAccessForRole("/admin/comerciais", "admin_master").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/comercial", "comercial").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/indicador", "indicador").allowed, true)
  })
})

describe("3.1E-A dismissed inativa profile", () => {
  it("dismissed marca inativação", () => {
    assert.equal(shouldInactivateProfileOnEmployeeStatus("dismissed"), true)
    assert.equal(shouldInactivateProfileOnEmployeeStatus("active"), false)
  })

  it("serviço não deleta auth.users", () => {
    const src = readSrc("lib/employees/admin.service.ts")
    assert.equal(src.includes("deleteUser"), false)
    const life = readSrc("lib/auth/account-lifecycle.ts")
    assert.equal(life.includes("deleteUser"), false)
    assert.match(life, /deleted: false/)
  })
})

describe("3.1E-A funcionario não entra no comercial legado", () => {
  it("prefixo /comercial negado", () => {
    assert.equal(evaluateRouteAccessForRole("/comercial", "funcionario").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/comercial/leads", "funcionario").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/comercial/nova-indicacao", "funcionario").allowed, false)
  })
})
