import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDirectDatabaseUrl: Boolean(process.env.DIRECT_DATABASE_URL),
    nodeEnv: process.env.NODE_ENV,
  });
}
