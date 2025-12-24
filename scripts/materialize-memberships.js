// scripts/materialize-memberships.js
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function pickStartDate(u) {
  return u.memberSince || u.createdAt || new Date();
}

function pickTypeFromRole(role) {
  return role === "DRIVER" ? "DRIVER" : "RIDER";
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function computeStatus(expiryDate) {
  return expiryDate.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
}

async function main() {
  const candidates = await prisma.user.findMany({
    where: {
      OR: [{ membershipActive: true }, { trialEndsAt: { not: null } }],
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      memberSince: true,
      membershipActive: true,
      trialEndsAt: true,
      memberships: { select: { id: true }, take: 1 },
    },
  });

  console.log(`Found ${candidates.length} candidate users`);

  let created = 0;
  let skipped = 0;

  for (const u of candidates) {
    if (u.memberships.length > 0) {
      skipped++;
      continue;
    }

    const startDate = pickStartDate(u);

    // expiry policy:
    // - if trialEndsAt exists: use it
    // - else if membershipActive: give a default 30 days from startDate (temporary bridge)
    // - else: fallback 30 days (should be rare due to where clause)
    const expiryDate = u.trialEndsAt
      ? new Date(u.trialEndsAt)
      : addDays(startDate, 30);

    const row = await prisma.membership.create({
      data: {
        userId: u.id,
        type: pickTypeFromRole(u.role),
        startDate,
        expiryDate,
        status: computeStatus(expiryDate),
        amountPaidCents: 0,
        paymentProvider: null,
        paymentRef: null,
      },
    });

    created++;
    console.log(
      `Created membership for ${u.email} (${u.role}) -> ${row.id} (expires ${expiryDate
        .toISOString()
        .slice(0, 10)})`
    );
  }

  console.log(`Done. Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
