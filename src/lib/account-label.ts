// What the sidebar shows for the signed-in account. In --auth none mode the
// server's single local user has a placeholder email (kept from before the
// rename for existing databases), so show neutral wording instead of it.

export interface AccountLabel {
  name: string
  detail: string
  initial: string
}

export function accountLabel(
  user: { name: string | null; email: string } | null,
  authMode: "none" | "password",
): AccountLabel {
  if (authMode === "none") return { name: "Local", detail: "local mode, no login", initial: "L" }
  const name = user?.name || "Engineer"
  return { name, detail: user?.email ?? "", initial: (user?.name || user?.email || "?").slice(0, 1).toUpperCase() }
}
