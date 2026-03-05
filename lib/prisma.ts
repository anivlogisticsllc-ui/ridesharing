// lib/prisma.ts
import { PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  prisma?: PrismaClient;
};

const g = globalThis as GlobalWithPrisma;

// Optional safety check (won’t affect your valid URLs)
function assertEnvPresent(name: "DATABASE_URL" | "DIRECT_DATABASE_URL") {
  const v = process.env[name];
  if (!v) {
    // Don’t throw if you prefer softer behavior, but this makes failures obvious
    throw new Error(`Missing env var: ${name}`);
  }
}
assertEnvPresent("DATABASE_URL");
assertEnvPresent("DIRECT_DATABASE_URL");

export const prisma =
  g.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") g.prisma = prisma;
