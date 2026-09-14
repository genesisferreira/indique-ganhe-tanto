import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createConfirmedAuthUserWithPassword } from "./create-confirmed-auth-user"

describe("createConfirmedAuthUserWithPassword", () => {
  it("C) a senha passada ao createUser é exatamente a informada", async () => {
    const seen: Array<{ email: string; password: string; email_confirm: boolean }> =
      []
    const result = await createConfirmedAuthUserWithPassword(
      {
        auth: {
          admin: {
            createUser: async (attrs) => {
              seen.push({
                email: attrs.email,
                password: attrs.password,
                email_confirm: attrs.email_confirm,
              })
              return { data: { user: { id: "user-1" } }, error: null }
            },
          },
        },
      },
      {
        email: "ana@example.com",
        password: "TempPass!2345678",
        userMetadata: { full_name: "Ana" },
      }
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.userId, "user-1")
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.password, "TempPass!2345678")
    assert.equal(seen[0]?.email, "ana@example.com")
    assert.equal(seen[0]?.email_confirm, true)
  })

  it("mapeia e-mail já existente", async () => {
    const result = await createConfirmedAuthUserWithPassword(
      {
        auth: {
          admin: {
            createUser: async () => ({
              data: { user: null },
              error: { message: "User already registered" },
            }),
          },
        },
      },
      { email: "ana@example.com", password: "x".repeat(16), userMetadata: {} }
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "email_exists")
  })
})
