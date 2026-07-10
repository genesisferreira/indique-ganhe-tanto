import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  type PlanCatalogRow,
  resolvePublicPlanSlots,
  rowNameBelongsToSlot,
  rowReservedForOtherSlot,
  PUBLIC_PLAN_SLOT_DEFINITIONS,
} from "./plan-resolver"

const plan500: PlanCatalogRow = {
  id: "uuid-500",
  name: "500 Mega",
  speed_label: "500 Mbps",
  is_active: true,
}

const plan1000Name: PlanCatalogRow = {
  id: "uuid-1000",
  name: "1000 MEGA",
  speed_label: "1 Gbps",
  is_active: true,
}

const plan1000Reversed: PlanCatalogRow = {
  id: "uuid-1000b",
  name: "MEGA 1000",
  speed_label: "1 Gbps",
  is_active: true,
}

const plan1000SpeedOnly: PlanCatalogRow = {
  id: "uuid-1000c",
  name: "Plano Premium",
  speed_label: "1 Gbps",
  is_active: true,
}

const plan1000WrongSpeedOn500: PlanCatalogRow = {
  id: "uuid-1000d",
  name: "1000 MEGA",
  speed_label: "500 Mbps",
  is_active: true,
}

describe("resolvePublicPlanSlots", () => {
  it("resolve 500 + 1000 quando ambos existem", () => {
    const result = resolvePublicPlanSlots({
      rows: [plan500, plan1000Name],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots.length, 2)
    assert.equal(result.slots[0].displayName, "500 Mega")
    assert.equal(result.slots[1].displayName, "1 Giga")
    assert.equal(result.slots[1].row.id, "uuid-1000")
  })

  it("resolve 1000 MEGA pelo nome exato", () => {
    const result = resolvePublicPlanSlots({ rows: [plan500, plan1000Name] })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots[1].row.name, "1000 MEGA")
  })

  it("resolve MEGA 1000 pelo nome invertido", () => {
    const result = resolvePublicPlanSlots({
      rows: [plan500, plan1000Reversed],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots[1].row.name, "MEGA 1000")
  })

  it("resolve 1000 por speed_label 1 Gbps", () => {
    const result = resolvePublicPlanSlots({
      rows: [plan500, plan1000SpeedOnly],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots[1].matchMethod, "speed_label")
  })

  it("não permite 1000 MEGA ocupar slot 500 por speed_label incorreto", () => {
    const result = resolvePublicPlanSlots({
      rows: [plan500, plan1000WrongSpeedOn500],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots[0].row.id, "uuid-500")
    assert.equal(result.slots[1].row.id, "uuid-1000d")
    assert.equal(result.slots[1].displayName, "1 Giga")
  })

  it("prioriza IDs explícitos via env", () => {
    const result = resolvePublicPlanSlots({
      rows: [plan500, plan1000Name],
      plan500Id: "uuid-500",
      plan1000Id: "uuid-1000",
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.slots[0].matchMethod, "env_id")
    assert.equal(result.slots[1].matchMethod, "env_id")
  })

  it("retorna erro controlado quando falta um plano", () => {
    const result = resolvePublicPlanSlots({ rows: [plan500] })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error, "PUBLIC_PLAN_MAPPING_INCOMPLETE")
    assert.deepEqual(result.missing, ["1000"])
  })

  it("não reutiliza o mesmo plano nos dois slots", () => {
    const result = resolvePublicPlanSlots({ rows: [plan500] })
    assert.equal(result.ok, false)
  })
})

describe("rowReservedForOtherSlot", () => {
  it("reserva 1000 MEGA para slot 1 Giga", () => {
    assert.equal(
      rowReservedForOtherSlot(plan1000WrongSpeedOn500, 0),
      true
    )
    assert.equal(
      rowNameBelongsToSlot(
        plan1000WrongSpeedOn500.name,
        PUBLIC_PLAN_SLOT_DEFINITIONS[1]
      ),
      true
    )
  })
})
