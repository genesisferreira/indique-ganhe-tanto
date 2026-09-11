import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AUTH_DISABLE_BAN_DURATION,
  disableAuthUserLogin,
  enableAuthUserLogin,
  shouldInactivateProfileOnEmployeeStatus,
} from "./account-lifecycle"

describe("account-lifecycle", () => {
  it("dismissed inativa; outros estados não", () => {
    assert.equal(shouldInactivateProfileOnEmployeeStatus("dismissed"), true)
    assert.equal(shouldInactivateProfileOnEmployeeStatus("paused"), false)
  })

  it("disableAuthUserLogin bane e nunca marca deleted", async () => {
    const calls: string[] = []
    const result = await disableAuthUserLogin(
      {
        auth: {
          admin: {
            updateUserById: async (id, attrs) => {
              calls.push(`ban:${id}:${attrs.ban_duration}`)
              return { error: null }
            },
            signOut: async (id, scope) => {
              calls.push(`signOut:${id}:${scope}`)
              return { error: null }
            },
          },
        },
      },
      "user-1"
    )
    assert.equal(result.deleted, false)
    assert.equal(result.banned, true)
    assert.equal(result.sessionsRevoked, true)
    assert.equal(result.ok, true)
    assert.deepEqual(calls, [
      `ban:user-1:${AUTH_DISABLE_BAN_DURATION}`,
      "signOut:user-1:global",
    ])
  })

  it("enableAuthUserLogin remove ban", async () => {
    const result = await enableAuthUserLogin(
      {
        auth: {
          admin: {
            updateUserById: async (_id, attrs) => {
              assert.equal(attrs.ban_duration, "none")
              return { error: null }
            },
          },
        },
      },
      "user-1"
    )
    assert.equal(result.ok, true)
  })
})
