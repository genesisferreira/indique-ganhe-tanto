import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  authorizeOperationalSectorAccess,
  membershipGrantsAdminRoute,
  requireActiveSectorMembership,
} from "@/lib/auth/sector-membership"
import { evaluateRouteAccessForRole } from "@/lib/auth/auth-audit"
import { stripBrowserActor } from "@/lib/collections/http-payload"

const memberBase = {
  sectorCode: "collections" as const,
  userId: "u1",
  profileId: "u1",
  role: "comercial" as const,
  profileIsActive: true,
  employeeId: "e1",
  employeeStatus: "active",
  membershipActive: true,
  membershipSectorCode: "collections",
}

describe("L) membership collections permite rota collections", () => {
  it("read e write ok", () => {
    assert.equal(
      authorizeOperationalSectorAccess({ ...memberBase, action: "read" }).ok,
      true
    )
    assert.equal(
      authorizeOperationalSectorAccess({ ...memberBase, action: "write" }).ok,
      true
    )
  })
})

describe("M) membership retention permite rota retention", () => {
  it("collections membership não autoriza retention write", () => {
    const auth = authorizeOperationalSectorAccess({
      ...memberBase,
      sectorCode: "retention",
      membershipSectorCode: "collections",
      membershipActive: true,
      action: "write",
    })
    assert.equal(auth.ok, false)
  })

  it("retention membership autoriza retention", () => {
    const auth = authorizeOperationalSectorAccess({
      ...memberBase,
      sectorCode: "retention",
      membershipSectorCode: "retention",
      action: "read",
    })
    assert.equal(auth.ok, true)
  })
})

describe("N) membership não concede /admin", () => {
  it("helper sempre false", () => {
    assert.equal(membershipGrantsAdminRoute("collections"), false)
  })

  it("role comercial continua bloqueado em /admin", () => {
    assert.equal(evaluateRouteAccessForRole("/admin", "comercial").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/admin/financeiro", "comercial").allowed, false)
  })
})

describe("F) employee inelegível não recebe (membership)", () => {
  it("paused falha requireActiveSectorMembership", () => {
    const r = requireActiveSectorMembership({
      sectorCode: "collections",
      employeeId: "e1",
      employeeStatus: "paused",
      membershipActive: true,
    })
    assert.equal(r.ok, false)
  })
})

describe("R) browser não controla actor", () => {
  it("strip remove actor/user/employee do payload", () => {
    const rest = stripBrowserActor({
      actor_profile_id: "hack",
      actorProfileId: "hack2",
      userId: "hack3",
      employeeId: "hack4",
      source: "controllr",
      sector_code: "collections",
      channel: "phone",
      outcome: "contacted",
    })
    assert.equal("actor_profile_id" in rest, false)
    assert.equal("actorProfileId" in rest, false)
    assert.equal("userId" in rest, false)
    assert.equal("employeeId" in rest, false)
    assert.equal("source" in rest, false)
    assert.equal("sector_code" in rest, false)
    assert.equal(rest.channel, "phone")
  })
})

describe("N/O) admin_consulta e admin_financeiro não escrevem no setor", () => {
  it("consulta write 403 mesmo com membership", () => {
    const auth = authorizeOperationalSectorAccess({
      ...memberBase,
      role: "admin_consulta",
      action: "write",
    })
    assert.equal(auth.ok, false)
  })

  it("financeiro write 403 mesmo com membership", () => {
    const auth = authorizeOperationalSectorAccess({
      ...memberBase,
      role: "admin_financeiro",
      action: "write",
    })
    assert.equal(auth.ok, false)
  })

  it("consulta continua lendo", () => {
    const auth = authorizeOperationalSectorAccess({
      ...memberBase,
      role: "admin_consulta",
      membershipActive: false,
      employeeId: null,
      employeeStatus: null,
      action: "read",
    })
    assert.equal(auth.ok, true)
  })
})

describe("indicador não acessa módulos", () => {
  it("/cobranca e /retencao bloqueados", () => {
    assert.equal(evaluateRouteAccessForRole("/cobranca", "indicador").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/retencao", "indicador").allowed, false)
  })

  it("comercial e admin_master passam no middleware de role", () => {
    assert.equal(evaluateRouteAccessForRole("/cobranca", "comercial").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/retencao", "admin_master").allowed, true)
  })
})
