// app/api/health/db/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const now = await prisma.$queryRaw`SELECT NOW()`;
    return NextResponse.json({
      ok: true,
      dbTime: now,
    });
  } catch (err) {
      console.error(err);
      return NextResponse.json(
        { ok: false, error: "DB connection failed" },
        { status: 500 }
      );
  }
}
