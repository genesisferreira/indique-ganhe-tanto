import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { authorizeOperationalAdminSettings, authorizeRetentionCustomerAccess } from "@/lib/auth/operational-admin"
import {
  COLLECTION_DEFAULT_MIN_DAYS_OVERDUE,
  COLLECTION_SETTINGS_DEFAULTS,
  validateCollectionSettingsPatch,
} from "@/lib/operational/settings"

describe("A) default minimum_days_overdue=5", () => {
  it("constante e defaults", () => {
    assert.equal(COLLECTION_DEFAULT_MIN_DAYS_OVERDUE, 5)
    assert.equal(COLLECTION_SETTINGS_DEFAULTS.minimumDaysOverdue, 5)
    assert.equal(COLLECTION_SETTINGS_DEFAULTS.includeCancelledCustomers, false)
    assert.equal(COLLECTION_SETTINGS_DEFAULTS.cancelledFilterOperational, false)
  })
})

describe("D/G/H) quem altera configuração", () => {
  const base = { userId: "u1", profileId: "u1" }

  it("Admin Master altera", () => {
    const auth = authorizeOperationalAdminSettings({
      ...base,
      role: "admin_master",
      action: "write",
    })
    assert.equal(auth.ok, true)
    if (auth.ok) assert.equal(auth.canWrite, true)
  })

  it("employee não altera", () => {
    const auth = authorizeOperationalAdminSettings({
      ...base,
      role: "comercial",
      action: "write",
    })
    assert.equal(auth.ok, false)
  })

  it("admin_consulta não altera", () => {
    const write = authorizeOperationalAdminSettings({
      ...base,
      role: "admin_consulta",
      action: "write",
    })
    const read = authorizeOperationalAdminSettings({
      ...base,
      role: "admin_consulta",
      action: "read",
    })
    assert.equal(write.ok, false)
    assert.equal(read.ok, true)
  })
})

describe("I/J) valores inválidos rejeitados", () => {
  it("0 rejeitado", () => {
    const r = validateCollectionSettingsPatch({ minimumDaysOverdue: 0 })
    assert.equal(r.ok, false)
  })

  it("texto inválido rejeitado", () => {
    const r = validateCollectionSettingsPatch({ minimumDaysOverdue: "abc" })
    assert.equal(r.ok, false)
  })

  it("7 aceito", () => {
    const r = validateCollectionSettingsPatch({ minimumDaysOverdue: 7 })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.settings.minimumDaysOverdue, 7)
  })
})

describe("N) employee sem retention → 403", () => {
  it("sem membership", () => {
    const r = authorizeRetentionCustomerAccess({
      role: "comercial",
      membershipActive: false,
      employeeStatus: "active",
      action: "read",
    })
    assert.equal(r.ok, false)
  })
})

describe("S) Admin Master consulta retenção", () => {
  it("read ok sem membership", () => {
    const r = authorizeRetentionCustomerAccess({
      role: "admin_master",
      membershipActive: false,
      employeeStatus: null,
      action: "read",
    })
    assert.equal(r.ok, true)
  })
})
