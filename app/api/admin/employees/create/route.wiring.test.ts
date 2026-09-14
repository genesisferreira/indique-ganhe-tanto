import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("3.1E-B wiring create route", () => {
  const src = read("app/api/admin/employees/create/route.ts")

  it("createUser só via helper compartilhado no cliente privilegiado", () => {
    assert.match(src, /createConfirmedAuthUserWithPassword/)
    assert.match(src, /getPrivileged\(\)/)
    assert.equal(src.includes("createBrowserClient"), false)
    assert.match(src, /authorizeEmployeeAdminRequest\("write"\)/)
    assert.match(src, /role: "funcionario"/)
    assert.equal(src.includes("NEXT_PUBLIC_SUPABASE_SERVICE"), false)
  })

  it("não envia e-mail automático de convite", () => {
    assert.equal(src.includes("inviteUserByEmail"), false)
    assert.equal(src.includes("resetPasswordForEmail"), false)
  })
})

describe("3.1E-B migration versionada e não financeira", () => {
  const sql = read("supabase/patch-employee-account-creation-3-1e-b.sql")
  it("adiciona campos HR e idempotência sem senha", () => {
    assert.match(sql, /job_title/)
    assert.match(sql, /birth_date/)
    assert.match(sql, /manager_employee_id/)
    assert.match(sql, /employee_account_creations/)
    assert.equal(sql.toLowerCase().includes("password"), false)
    assert.equal(sql.includes("salary"), false)
    assert.equal(sql.includes("drop table"), false)
  })

  it("existence checks de constraint são table-scoped em public.employees", () => {
    assert.match(sql, /conname = 'employees_manager_employee_id_fkey'\s+and conrelid = 'public\.employees'::regclass/)
    assert.match(sql, /conname = 'employees_manager_not_self_chk'\s+and conrelid = 'public\.employees'::regclass/)
    assert.match(sql, /conname = 'employees_job_title_len_chk'\s+and conrelid = 'public\.employees'::regclass/)
    assert.equal((sql.match(/where conname =/g) ?? []).length, 3)
  })
})
