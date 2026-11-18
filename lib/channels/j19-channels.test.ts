import assert from "node:assert/strict"
import test from "node:test"
import { buildInternalReturn } from "@/lib/period/return-to"
import { channelRewardAllowed, classifyChannel, notificationTitle, type ChannelEvidence } from "@/lib/channels/classification"

const empty: ChannelEvidence = {
  originKind: null,
  source: null,
  erpLeadSource: null,
  indicatorProfileId: null,
  partnerKey: null,
  employeeKey: null,
  campaign: null,
  employeeRole: null,
}

test("classifica pré-cadastro, indicação, parceiro, técnico, vendedor e ambíguo", () => {
  const direct = classifyChannel({ ...empty, originKind: "legacy", source: "public_pre_registration", erpLeadSource: "Pré-cadastro Web" })
  const indicator = classifyChannel({ ...empty, originKind: "legacy", erpLeadSource: "Indique e Ganhe", indicatorProfileId: "profile-1" })
  const partner = classifyChannel({ ...empty, originKind: "partner_merchant", partnerKey: "partner-1" })
  const technician = classifyChannel({ ...empty, originKind: "employee", employeeKey: "emp-1", employeeRole: "technician_originator" })
  const external = classifyChannel({ ...empty, originKind: "employee", employeeKey: "emp-2", employeeRole: "external_sales_originator" })
  const ambiguous = classifyChannel({ ...empty, originKind: "partner_merchant", partnerKey: "partner-1", indicatorProfileId: "profile-1", erpLeadSource: "Indique e Ganhe" })
  assert.deepEqual(direct, { originGroup: "direct", acquisitionKind: "direct_preregistration" })
  assert.deepEqual(indicator, { originGroup: "referral", acquisitionKind: "indicator" })
  assert.deepEqual(partner, { originGroup: "referral", acquisitionKind: "partner_merchant" })
  assert.deepEqual(technician, { originGroup: "referral", acquisitionKind: "employee_technician" })
  assert.deepEqual(external, { originGroup: "referral", acquisitionKind: "employee_external_sales" })
  assert.deepEqual(ambiguous, { originGroup: "unclassified", acquisitionKind: "unclassified_legacy" })
  assert.equal(channelRewardAllowed(direct), false)
  assert.equal(channelRewardAllowed(ambiguous), false)
  assert.equal(channelRewardAllowed(indicator), true)
  assert.equal(channelRewardAllowed(partner), false)
  assert.equal(channelRewardAllowed(technician), false)
})

test("indicação sem originador e sem evidência de captação permanece ambígua", () => {
  const row = classifyChannel({ ...empty, originKind: "indicator", erpLeadSource: "Indique e Ganhe" })
  assert.deepEqual(row, { originGroup: "unclassified", acquisitionKind: "unclassified_legacy" })
  assert.equal(channelRewardAllowed(row), false)
})

test("funcionário sem papel permanece não classificado", () => {
  const row = classifyChannel({ ...empty, originKind: "employee", employeeKey: "emp-3" })
  assert.equal(row.acquisitionKind, "unclassified_legacy")
})

test("campanha persistida vira captação de campanha e não inventa originador", () => {
  const row = classifyChannel({ ...empty, originKind: "web_preregistration", source: "public_pre_registration", erpLeadSource: "Pré-cadastro Web", campaign: "maio" })
  assert.deepEqual(row, { originGroup: "direct", acquisitionKind: "direct_campaign" })
})

test("o total classificado conserva cada registro em um único canal", () => {
  const rows = [
    ...Array.from({ length: 230 }, () => classifyChannel({ ...empty, originKind: "legacy", source: "public_pre_registration", erpLeadSource: "Pré-cadastro Web" })),
    ...Array.from({ length: 40 }, () => classifyChannel({ ...empty, originKind: "indicator", erpLeadSource: "Indique e Ganhe", indicatorProfileId: "profile-1" })),
  ]
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(`${row.originGroup}:${row.acquisitionKind}`, (counts.get(`${row.originGroup}:${row.acquisitionKind}`) ?? 0) + 1)
  assert.equal(rows.length, 270)
  assert.equal(counts.get("direct:direct_preregistration"), 230)
  assert.equal(counts.get("referral:indicator"), 40)
  assert.equal([...counts.values()].reduce((sum, value) => sum + value, 0), 270)
})

test("o retorno da lista preserva o canal e a página", () => {
  const params = new URLSearchParams("channel=indicator&month=2026-11&page=2&pageSize=20")
  assert.equal(buildInternalReturn("/admin/indicacoes", params), "/admin/indicacoes?month=2026-11&page=2&pageSize=20&channel=indicator")
})

test("notificações de captação e indicação usam títulos diferentes", () => {
  assert.equal(notificationTitle("direct_preregistration"), "Nova captação direta")
  assert.equal(notificationTitle("indicator"), "Nova indicação")
  assert.equal(notificationTitle("partner_merchant"), "Nova indicação de comércio parceiro")
  assert.equal(notificationTitle("employee_technician"), "Nova indicação de funcionário")
})
