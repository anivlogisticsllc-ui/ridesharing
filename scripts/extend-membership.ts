// scripts/extend-membership.ts
import "dotenv/config";
import { PrismaClient, MembershipType, MembershipStatus } from "@prisma/client";

/**
 * Examples:
 *   npx tsx scripts/extend-membership.ts --days 30
 *   npx tsx scripts/extend-membership.ts --userId <USER_ID> --days 60
 *   npx tsx scripts/extend-membership.ts --type RIDER --days 30
 *   npx tsx scripts/extend-membership.ts --type DRIVER --days 30
 *
 * Notes:
 * - If membership is expired, extends from "now"; otherwise extends from current expiryDate.
 * - Sets status to ACTIVE.
 * - Does NOT use or accept BOTH.
 */

const prisma = new PrismaClient();

type ExtendType = "RIDER" | "DRIVER";

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return typeof v === "string" ? v : null;
}

function parseDays(v: string | null): number {
  const n = Number(v ?? "");
  if (!Number.isFinite(n) || n <= 0 || n > 3650) {
    throw new Error('Invalid --days (must be 1..3650). Example: --days 30');
  }
  return Math.floor(n);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseType(raw: string | null): MembershipType | null {
  if (!raw) return null; // null => no filter, update all types

  const t = raw.trim().toUpperCase();

  // hard block legacy keyword
  if (t === "BOTH") {
    throw new Error('Invalid --type "BOTH". Use no --type to update all, or --type RIDER / --type DRIVER.');
  }

  if (t === "RIDER") return MembershipType.RIDER;
  if (t === "DRIVER") return MembershipType.DRIVER;

  throw new Error('Invalid --type. Use RIDER or DRIVER (or omit --type).');
}

async function main(): Promise<void> {
  const userId = (getArg("userId") ?? "").trim() || null;
  const days = parseDays(getArg("days") ?? "30");
  const type = parseType(getArg("type"));

  const where = {
    ...(userId ? { userId } : {}),
    ...(type ? { type } : {}),
  };

  const rows = await prisma.membership.findMany({
    where,
    select: {
      id: true,
      userId: true,
      type: true,
      expiryDate: true,
      status: true,
    },
    orderBy: [{ userId: "asc" }, { type: "asc" }, { startDate: "desc" }],
  });

  console.log(`Found ${rows.length} membership rows to extend`);
  if (rows.length === 0) return;

  const now = new Date();

  let updated = 0;
  for (const m of rows) {
    const base = m.expiryDate && m.expiryDate > now ? m.expiryDate : now;
    const next = addDays(base, days);

    await prisma.membership.update({
      where: { id: m.id },
      data: { expiryDate: next, status: MembershipStatus.ACTIVE },
    });

    updated++;
    console.log(
      `✓ ${m.userId} ${m.type}: ${m.expiryDate.toISOString()} -> ${next.toISOString()} (was ${m.status})`
    );
  }

  console.log(`Done. Updated: ${updated}`);
}

main()
  .catch((e) => {
    console.error("Extend membership failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });