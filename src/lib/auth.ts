import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Name", type: "text" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null

        const mode = credentials.mode || "signin"

        if (mode === "signup") {
          // Create a new user
          if (!credentials.password || credentials.password.length < 6) {
            throw new Error("Password must be at least 6 characters")
          }
          const existing = await db.user.findUnique({ where: { email: credentials.email } })
          if (existing) {
            throw new Error("An account with this email already exists")
          }
          const passwordHash = await bcrypt.hash(credentials.password, 10)
          const user = await db.user.create({
            data: {
              email: credentials.email,
              name: credentials.name || credentials.email.split("@")[0],
              passwordHash,
            },
          })
          await seedDemoForUser(user.id)
          return { id: user.id, email: user.email, name: user.name } as any
        }

        // Sign in
        const user = await db.user.findUnique({ where: { email: credentials.email } })
        if (!user || !user.passwordHash) {
          throw new Error("No account found with this email. Sign up instead.")
        }
        const valid = await bcrypt.compare(credentials.password || "", user.passwordHash)
        if (!valid) {
          throw new Error("Incorrect password")
        }
        return { id: user.id, email: user.email, name: user.name } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
      }
      return session
    },
  },
}

// Demo seeding on signup (imported here to avoid circular deps)
async function seedDemoForUser(userId: string) {
  try {
    const { seedDemoData } = await import("@/lib/seed")
    await seedDemoData(userId)
  } catch (e) {
    console.error("Demo seed failed:", e)
  }
}

export async function getCurrentUser(session: any) {
  if (!session?.user?.id) return null
  return session.user
}
