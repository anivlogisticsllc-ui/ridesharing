import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // MVP placeholder (real data later)
  return NextResponse.json({
    ok: true,
    totals: { serviceFeesCents: 0 },
    ridePayments: [],
    payouts: [],
  });
}
