import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildTemporaryAccessClipboardText,
  CRM_LOGIN_URL,
  normalizeLoginEmail,
} from "./temporary-access-delivery"

describe("temporary-access-delivery", () => {
  it("normaliza e-mail com trim e lowercase; senha permanece intacta no clipboard", () => {
    assert.equal(normalizeLoginEmail("  Ana.FUNC@Example.COM "), "ana.func@example.com")
    const text = buildTemporaryAccessClipboardText({
      email: "  Ana.FUNC@Example.COM ",
      temporaryPassword: "AbC!@#$%2345678",
    })
    assert.match(text, /Login: ana.func@example.com/)
    assert.match(text, /Senha temporária: AbC!@#\$%2345678/)
    assert.match(text, new RegExp(CRM_LOGIN_URL.replace(/\./g, "\\.")))
    assert.equal(text.includes("  Ana"), false)
  })
})
