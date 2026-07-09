import crypto from "crypto"

// API keys look like: atr_<32 hex chars>
export function generateApiKey(): string {
  return "atr_" + crypto.randomBytes(16).toString("hex")
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

export function keyPrefix(key: string): string {
  return key.slice(0, 12) // atr_xxxxxxxx
}
