// scripts/extend-memberships.js
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Usage examples:
 *   node scripts/extend-memberships.js --days 30
 *   node scripts/extend-memberships.js --userId <USER_ID> --days 60
 *   node scripts/extend-memberships.js --type RIDER --days 30
 *   node scripts/extend-memberships.js --type BOTH --days 30
 *
 * Notes:
 * - Extends expiryDate forward from "now" if already expired, otherwise extends from current expiryDate.
 * - Sets status to ACTIVE.
 * - amountPaidCents is left as-is.
 */

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function parseDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 3650) return null;
  return Math.floor(n);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const userId = getArg("userId");
  const typeRaw = (getArg("type") || "BOTH").toUpperCase(); // RIDER | DRIVER | BOTH
  const days = parseDays(getArg("days") || "30");

  if (!days) {
    throw new Error("Invalid --days (must be 1..3650). Example: --days 30");
  }

  const typeFilter =
    typeRaw === "RIDER" || typeRaw === "DRIVER"
      ? typeRaw
      : typeRaw === "BOTH"
      ? null
      : null;

  // Find latest membership per (userId,type) or for one user
  // If userId is provided, update that user's memberships; otherwise, update all.
  const where = {
    ...(userId ? { userId } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  // We'll update *all matching memberships* (simple + predictable).
  // If you prefer "latest only", tell me and I’ll adjust.
  const rows = await prisma.membership.findMany({
    where,
    select: {
      id: true,
      userId: true,
      type: true,
      expiryDate: true,
      status: true,
      amountPaidCents: true,
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
      data: {
        expiryDate: next,
        status: "ACTIVE",
      },
    });

    updated++;
    console.log(
      `✓ ${m.userId} ${m.type} : ${m.expiryDate.toISOString()} -> ${next.toISOString()} (was ${m.status})`
    );
  }

  console.log(`Done. Updated: ${updated}`);

  // Optional: keep legacy User fields aligned for MVP UI
  // (Does NOT affect guardMembership, but helps any legacy screens.)
  if (userId) {
    const maxExpiry = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { expiryDate: "desc" },
      select: { expiryDate: true },
    });

    if (maxExpiry?.expiryDate) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          membershipActive: true,
          membershipPlan: "STANDARD",
          trialEndsAt: maxExpiry.expiryDate,
        },
      });
      console.log(`✓ Synced User legacy fields trialEndsAt -> ${maxExpiry.expiryDate.toISOString()}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("Extend memberships failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
