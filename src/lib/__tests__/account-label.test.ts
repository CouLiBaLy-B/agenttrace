import { describe, expect, it } from "vitest"
import { accountLabel } from "@/lib/account-label"

describe("accountLabel", () => {
  it("hides the local user's placeholder email in --auth none mode", () => {
    const label = accountLabel({ name: "Local", email: "local@agenttrace" }, "none")
    expect(label).toEqual({ name: "Local", detail: "local mode, no login", initial: "L" })
    expect(JSON.stringify(label)).not.toContain("@")
  })
  it("shows the account in password mode", () => {
    expect(accountLabel({ name: "Ada", email: "ada@example.com" }, "password")).toEqual({
      name: "Ada",
      detail: "ada@example.com",
      initial: "A",
    })
    expect(accountLabel({ name: null, email: "bob@example.com" }, "password")).toEqual({
      name: "Engineer",
      detail: "bob@example.com",
      initial: "B",
    })
  })
})
