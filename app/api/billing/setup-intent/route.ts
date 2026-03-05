// app/api/billing/setup-intent/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return null;
  return { userId };
}

export async function POST() {
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });
  if (!user) return jsonError(404, "User not found");

  let customerId = user.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: { userId: user.id },
    });

    customerId = customer.id;

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  } else {
    // keep metadata in sync (helps debugging)
    await stripe.customers.update(customerId, {
      metadata: { userId: user.id },
    });
  }

  const si = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"], // <-- card only (prevents Link / other types)
    metadata: { userId: user.id },
  });

  return NextResponse.json({
    ok: true,
    customerId,
    clientSecret: si.client_secret,
  });
}