import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect admin pages + admin APIs
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const token = await getToken({ req });

    const isAdmin = Boolean((token as any)?.isAdmin);

    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("callbackUrl", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    if (!isAdmin) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
