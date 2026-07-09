// AgentTrace — Prisma 7 config
// Prisma 7 no longer accepts `url` inside schema.prisma. The connection URL
// for Prisma Migrate / db push lives here; the runtime client gets its URL
// via the driver adapter in src/lib/db.ts.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
