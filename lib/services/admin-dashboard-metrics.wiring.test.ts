/**
 * Wiring — loadAdminDashboardMetricsFromSupabase usa agregação que
 * exclui indicator_profile_id null (hotfix 22P02).
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const serviceSrc = readFileSync(join(here, "supabase-data.service.ts"), "utf8")

describe("admin dashboard metrics wiring — null indicator", () => {
  it("usa aggregateAdminDashboardReferralCharts", () => {
    assert.match(serviceSrc, /aggregateAdminDashboardReferralCharts/)
  })

  it("sanitiza IDs antes de profiles.in", () => {
    assert.match(serviceSrc, /sanitizeIndicatorIdsForProfilesIn/)
  })

  it("só chama .in(\"id\", …) quando indicatorIds.length > 0", () => {
    const fnStart = serviceSrc.indexOf(
      "export async function loadAdminDashboardMetricsFromSupabase"
    )
    assert.ok(fnStart >= 0)
    const fnSlice = serviceSrc.slice(fnStart, fnStart + 12000)
    assert.match(fnSlice, /if\s*\(\s*indicatorIds\.length\s*>\s*0\s*\)/)
    assert.match(fnSlice, /\.in\(\s*["']id["']\s*,\s*indicatorIds\s*\)/)
  })

  it("não faz mais indicatorAgg.set\(row.indicator_profile_id sem guard no loader", () => {
    const fnStart = serviceSrc.indexOf(
      "export async function loadAdminDashboardMetricsFromSupabase"
    )
    const fnEnd = serviceSrc.indexOf(
      "export async function markNotificationAsRead",
      fnStart
    )
    const fnBody = serviceSrc.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 15000)
    assert.equal(
      /indicatorAgg\.set\(\s*row\.indicator_profile_id/.test(fnBody),
      false,
      "agregação inline com set(row.indicator_profile_id) não deve existir no loader"
    )
  })
})
