import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS } from "./constants"
import {
  buildIndicatorSearchOrFilter,
  buildSearchFilters,
  runCommercialIndicatorSearch,
  type IndicatorSearchDeps,
} from "./indicator-search.service"
import { normalizeIndicatorSearchQuery } from "./search-query"
import {
  isValidIndicatorForAssistedReferral,
  mapIndicatorSearchResult,
} from "./search-result"

function makeDeps(
  overrides: Partial<IndicatorSearchDeps> & {
    rows?: Parameters<IndicatorSearchDeps["searchIndicatorRows"]> extends [
      infer _A,
    ]
      ? Awaited<ReturnType<IndicatorSearchDeps["searchIndicatorRows"]>>
      : never
  } = {}
): IndicatorSearchDeps & { audits: unknown[] } {
  const audits: unknown[] = []
  return {
    audits,
    getUser: overrides.getUser ?? (async () => ({ id: "comercial-1" })),
    getActorProfile:
      overrides.getActorProfile ??
      (async () => ({
        id: "comercial-1",
        role: "comercial",
        is_active: true,
      })),
    searchIndicatorRows:
      overrides.searchIndicatorRows ??
      (async () => overrides.rows ?? []),
    insertSearchAudit:
      overrides.insertSearchAudit ??
      (async ({ metadata }) => {
        audits.push(metadata)
      }),
  }
}

describe("commercial indicator search service", () => {
  it("resultado limitado e somente indicador ativo", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `id-${i}`,
      full_name: `Indicador ${i}`,
      phone: "11999990000",
      email: `i${i}@ex.com`,
      cpf: null,
      is_active: true,
      role: "indicador",
    }))
    many.push({
      id: "inactive",
      full_name: "Inativo",
      phone: "11999990001",
      email: "x@ex.com",
      cpf: null,
      is_active: false,
      role: "indicador",
    })
    many.push({
      id: "comercial-row",
      full_name: "Comercial",
      phone: "11999990002",
      email: "c@ex.com",
      cpf: null,
      is_active: true,
      role: "comercial",
    })

    const deps = makeDeps({ rows: many })
    const result = await runCommercialIndicatorSearch(deps, "Ind")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(result.results.length <= COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS)
    assert.equal(
      result.results.every((r) => r.is_active && !("role" in r)),
      true
    )
  })

  it("mascara telefone, e-mail e CPF; CPF null não vaza", async () => {
    const mapped = mapIndicatorSearchResult({
      id: "i1",
      full_name: "João",
      phone: "11987654321",
      email: "joao@tanto.com",
      cpf: "52998224725",
      is_active: true,
      role: "indicador",
    })
    assert.ok(mapped)
    assert.equal(mapped!.phone_masked, "(**) *****-4321")
    assert.equal(mapped!.email_masked, "jo***@tanto.com")
    assert.equal(mapped!.document_masked, "***.***.***-25")
    assert.equal(
      mapIndicatorSearchResult({
        id: "i2",
        full_name: "Sem CPF",
        phone: "11987654321",
        email: "a@b.com",
        cpf: null,
        is_active: true,
        role: "indicador",
      })!.document_masked,
      null
    )
  })

  it("não retorna Pix nem dados financeiros", async () => {
    const deps = makeDeps({
      rows: [
        {
          id: "i1",
          full_name: "Maria",
          phone: "11999998888",
          email: "maria@ex.com",
          cpf: null,
          is_active: true,
          role: "indicador",
        },
      ],
    })
    const result = await runCommercialIndicatorSearch(deps, "Maria")
    assert.equal(result.ok, true)
    if (!result.ok) return
    const json = JSON.stringify(result.results)
    assert.equal(json.includes("pix"), false)
    assert.equal(json.includes("wallet"), false)
    assert.equal(json.includes("reward"), false)
    assert.equal(json.includes("chave"), false)
  })

  it("busca por nome/telefone/e-mail/CPF monta filtros corretos", () => {
    const name = normalizeIndicatorSearchQuery("Maria")
    assert.equal(name.ok, true)
    if (name.ok) {
      const f = buildSearchFilters(name)
      assert.ok(f.namePattern?.includes("Maria"))
      assert.ok(buildIndicatorSearchOrFilter(f)?.includes("full_name.ilike"))
    }

    const phone = normalizeIndicatorSearchQuery("3133334444")
    assert.equal(phone.ok, true)
    if (phone.ok) {
      const f = buildSearchFilters(phone)
      assert.ok(f.phoneDigitsPattern)
      assert.equal(f.namePattern, null)
    }

    const email = normalizeIndicatorSearchQuery("a@b.com")
    assert.equal(email.ok, true)
    if (email.ok) {
      const f = buildSearchFilters(email)
      assert.ok(f.emailPattern)
    }

    const cpf = normalizeIndicatorSearchQuery("52998224725")
    assert.equal(cpf.ok, true)
    if (cpf.ok) {
      const f = buildSearchFilters(cpf)
      assert.equal(f.cpfDigits, "52998224725")
    }
  })

  it("audit não grava query/PII em claro", async () => {
    const deps = makeDeps({
      rows: [
        {
          id: "i1",
          full_name: "Maria",
          phone: "11999998888",
          email: "maria@ex.com",
          cpf: "52998224725",
          is_active: true,
          role: "indicador",
        },
      ],
    })
    await runCommercialIndicatorSearch(deps, "52998224725")
    assert.equal(deps.audits.length, 1)
    const meta = JSON.stringify(deps.audits[0])
    assert.equal(meta.includes("52998224725"), false)
    assert.equal(meta.includes("maria@ex.com"), false)
    assert.equal(meta.includes("11999998888"), false)
    assert.ok(meta.includes("query_type"))
    assert.ok(meta.includes("results_count"))
  })

  it("query vazia/curta negada pelo serviço", async () => {
    const empty = await runCommercialIndicatorSearch(makeDeps(), "")
    assert.equal(empty.ok, false)
    if (!empty.ok) assert.equal(empty.status, 400)

    const short = await runCommercialIndicatorSearch(makeDeps(), "ab")
    assert.equal(short.ok, false)
    if (!short.ok) assert.equal(short.status, 400)
  })

  it("indicador não autorizado pelo serviço", async () => {
    const deps = makeDeps({
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "indicador",
        is_active: true,
      }),
    })
    const result = await runCommercialIndicatorSearch(deps, "Maria")
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("1) anônimo → 401 e zero operações privilegiadas", async () => {
    let privilegedCalls = 0
    const deps = makeDeps({
      getUser: async () => null,
      searchIndicatorRows: async () => {
        privilegedCalls += 1
        return []
      },
    })
    const result = await runCommercialIndicatorSearch(deps, "Maria")
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
    assert.equal(privilegedCalls, 0)
  })

  it("2-5/9) roles negadas → zero operações privilegiadas", async () => {
    for (const role of [
      "indicador",
      "admin_consulta",
      "admin_financeiro",
    ] as const) {
      let privilegedCalls = 0
      const deps = makeDeps({
        getActorProfile: async () => ({
          id: "comercial-1",
          role,
          is_active: true,
        }),
        searchIndicatorRows: async () => {
          privilegedCalls += 1
          return []
        },
      })
      const result = await runCommercialIndicatorSearch(deps, "Maria")
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.status, 403)
      assert.equal(privilegedCalls, 0, role)
    }

    let inactiveCalls = 0
    const inactive = makeDeps({
      getActorProfile: async () => ({
        id: "comercial-1",
        role: "comercial",
        is_active: false,
      }),
      searchIndicatorRows: async () => {
        inactiveCalls += 1
        return []
      },
    })
    const inactiveResult = await runCommercialIndicatorSearch(inactive, "Maria")
    assert.equal(inactiveResult.ok, false)
    assert.equal(inactiveCalls, 0)
  })

  it("6-7) Comercial e Admin Master ativos permitem busca privilegiada", async () => {
    for (const role of ["comercial", "admin_master"] as const) {
      let privilegedCalls = 0
      const deps = makeDeps({
        getActorProfile: async () => ({
          id: "comercial-1",
          role,
          is_active: true,
        }),
        searchIndicatorRows: async () => {
          privilegedCalls += 1
          return [
            {
              id: "ind-sem-referral",
              full_name: "Maria Nova",
              phone: "11999998888",
              email: "maria.nova@ex.com",
              cpf: "52998224725",
              is_active: true,
              role: "indicador",
            },
          ]
        },
      })
      const result = await runCommercialIndicatorSearch(deps, "Maria")
      assert.equal(result.ok, true, role)
      assert.equal(privilegedCalls, 1, role)
      if (!result.ok) return
      assert.equal(result.results[0]?.id, "ind-sem-referral")
    }
  })

  it("12-17) nome/CPF/email/telefone e indicador sem referral encontrados", async () => {
    const row = {
      id: "ind-1",
      full_name: "Ana Silva",
      phone: "31988887777",
      email: "ana.silva@ex.com",
      cpf: "52998224725",
      is_active: true,
      role: "indicador",
    }
    const cases: Array<{ q: string; expectType: string }> = [
      { q: "Ana", expectType: "name" },
      { q: "52998224725", expectType: "cpf" },
      { q: "ana.silva@ex.com", expectType: "email" },
      { q: "3198888777", expectType: "phone" },
    ]
    for (const c of cases) {
      const deps = makeDeps({ rows: [row] })
      const result = await runCommercialIndicatorSearch(deps, c.q)
      assert.equal(result.ok, true, c.q)
      if (!result.ok) return
      assert.equal(result.query_type, c.expectType, c.q)
      assert.equal(result.results.length, 1, c.q)
      assert.equal(result.results[0]?.id, "ind-1", c.q)
    }
  })

  it("24) escaping %/_ preservado nos filtros de nome", () => {
    const normalized = normalizeIndicatorSearchQuery("100%_off")
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return
    const f = buildSearchFilters(normalized)
    assert.ok(f.namePattern?.includes("100\\%\\_off"))
    assert.ok(buildIndicatorSearchOrFilter(f)?.includes("100\\%\\_off"))
  })

  it("revalidação futura de indicador para criação assistida", () => {
    assert.equal(
      isValidIndicatorForAssistedReferral({
        id: "i1",
        role: "indicador",
        is_active: true,
      }).ok,
      true
    )
    assert.equal(
      isValidIndicatorForAssistedReferral({
        id: "i1",
        role: "comercial",
        is_active: true,
      }).ok,
      false
    )
    assert.equal(
      isValidIndicatorForAssistedReferral({
        id: "i1",
        role: "indicador",
        is_active: false,
      }).ok,
      false
    )
  })
})
