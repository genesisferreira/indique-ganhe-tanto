import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  FUNCIONARIO_PROFILE_PATH,
  MANAGER_UNDEFINED_LABEL,
  maskEmployeeCpfForSelfDisplay,
  presentFuncionarioSelfProfile,
  sessionBoundProfileUserId,
  type FuncionarioSelfProfileRecords,
} from "./self-profile"

const ownProfileId = "profile-a"
const ownEmployeeId = "employee-a"

function records(
  patch: Partial<FuncionarioSelfProfileRecords> = {}
): FuncionarioSelfProfileRecords {
  return {
    profile: {
      id: ownProfileId,
      role: "funcionario",
      is_active: true,
      must_change_password: false,
      full_name: "Ana Silva",
      email: "ana@example.com",
      phone: "11999999999",
      cpf: "12345678909",
    },
    employee: {
      id: ownEmployeeId,
      profile_id: ownProfileId,
      status: "active",
      job_title: "Analista",
      birth_date: "1990-05-20",
      manager_employee_id: "manager-1",
    },
    managerName: "Carlos Gestor",
    memberships: [
      { sectorCode: "collections", sectorName: "Cobrança", isActive: true },
    ],
    ...patch,
  }
}

describe("funcionario self profile", () => {
  it("A) rota canônica existe", () => {
    assert.equal(FUNCIONARIO_PROFILE_PATH, "/funcionario/perfil")
  })

  it("B) funcionário autenticado vê o próprio perfil", () => {
    const result = presentFuncionarioSelfProfile(records())
    assert.equal(result.kind, "ok")
    if (result.kind !== "ok") return
    assert.equal(result.view.fullName, "Ana Silva")
    assert.equal(result.view.email, "ana@example.com")
    assert.equal(result.view.jobTitle, "Analista")
  })

  it("C) outro role não recebe acesso de funcionário", () => {
    const result = presentFuncionarioSelfProfile(
      records({
        profile: {
          ...records().profile!,
          role: "comercial",
        },
      })
    )
    assert.equal(result.kind, "wrong_role")
  })

  it("D) profile inativo é bloqueado", () => {
    const result = presentFuncionarioSelfProfile(
      records({
        profile: {
          ...records().profile!,
          is_active: false,
        },
      })
    )
    assert.equal(result.kind, "inactive")
  })

  it("E) employee ausente falha fechado", () => {
    const result = presentFuncionarioSelfProfile(records({ employee: null }))
    assert.equal(result.kind, "missing_employee")
  })

  it("F) employee A não seleciona employee B", () => {
    const bound = sessionBoundProfileUserId({
      sessionUserId: ownProfileId,
      requestedEmployeeId: "employee-b",
      requestedProfileId: "profile-b",
      requestedId: "employee-b",
    })
    assert.equal(bound, ownProfileId)
    const mismatched = presentFuncionarioSelfProfile(
      records({
        employee: {
          id: "employee-b",
          profile_id: "profile-b",
          status: "active",
          job_title: "Outro",
          birth_date: null,
          manager_employee_id: null,
        },
      })
    )
    assert.equal(mismatched.kind, "missing_employee")
  })

  it("G/H) CPF mascarado e dígitos do meio não aparecem", () => {
    assert.equal(maskEmployeeCpfForSelfDisplay("12345678909"), "123.***.***-09")
    const result = presentFuncionarioSelfProfile(records())
    assert.equal(result.kind, "ok")
    if (result.kind !== "ok") return
    assert.equal(result.view.cpfMasked, "123.***.***-09")
    assert.equal(result.view.cpfMasked.includes("456"), false)
    assert.equal(result.view.cpfMasked.includes("12345678909"), false)
  })

  it("M/N) gestor e memberships próprios", () => {
    const result = presentFuncionarioSelfProfile(records())
    assert.equal(result.kind, "ok")
    if (result.kind !== "ok") return
    assert.equal(result.view.managerName, "Carlos Gestor")
    assert.equal(result.view.memberships[0]?.name, "Cobrança")
    assert.equal(result.view.memberships[0]?.isActive, true)
    const noManager = presentFuncionarioSelfProfile(
      records({ managerName: null })
    )
    assert.equal(noManager.kind, "ok")
    if (noManager.kind !== "ok") return
    assert.equal(noManager.view.managerName, MANAGER_UNDEFINED_LABEL)
  })

  it("sessão ausente não usa ids de query", () => {
    assert.equal(
      sessionBoundProfileUserId({
        sessionUserId: null,
        requestedEmployeeId: "employee-b",
      }),
      null
    )
  })

  it("dismissed não abre perfil funcional", () => {
    const result = presentFuncionarioSelfProfile(
      records({
        employee: {
          ...records().employee!,
          status: "dismissed",
        },
      })
    )
    assert.equal(result.kind, "dismissed")
  })
})
