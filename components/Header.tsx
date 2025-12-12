"use client";

import Link from "next/link";
import { useSession, signIn, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const userRole = (session?.user as any)?.role as
    | "RIDER"
    | "DRIVER"
    | "BOTH"
    | undefined;

  const isRider = userRole === "RIDER" || userRole === "BOTH";
  const isDriver = userRole === "DRIVER" || userRole === "BOTH";

  // Active nav indicator
  const linkClass = (href: string) => {
    const isActive =
      href === "/" ? pathname === "/" : pathname?.startsWith(href);

    return [
      "relative text-xs font-medium transition-colors",
      isActive
        ? "text-slate-900 after:absolute after:left-0 after:-bottom-1 after:h-[2px] after:w-full after:rounded-full after:bg-slate-900"
        : "text-slate-600 hover:text-slate-900",
    ].join(" ");
  };

  const rawName =
    ((session?.user as any)?.name as string | undefined) ||
    session?.user?.email ||
    "Profile";

  const initials = rawName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* LEFT: Logo + Nav */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              R
            </div>
            <span className="text-sm font-semibold text-slate-900">
              RideShare
            </span>
          </Link>

          <nav className="ml-4 hidden gap-4 md:flex">
            <Link href="/" className={linkClass("/")}>
              Home
            </Link>

            <Link href="/routes" className={linkClass("/routes")}>
              Routes &amp; Rates
            </Link>

            {/* Membership top nav */}
            {!session ? (
              <Link
                href="#membership-plans"
                className={linkClass("#membership-plans")}
              >
                Membership
              </Link>
            ) : (
              <Link
                href="/billing/membership"
                className={linkClass("/billing/membership")}
              >
                Membership &amp; billing
              </Link>
            )}

            {/* Rider-only portal */}
            {isRider && (
              <Link
                href="/rider/portal"
                className={linkClass("/rider/portal")}
              >
                Rider portal
              </Link>
            )}

            {/* Driver-only navigation */}
            {isDriver && (
              <>
                <Link
                  href="/driver/dashboard"
                  className={linkClass("/driver/dashboard")}
                >
                  Driver dashboard
                </Link>
                <Link
                  href="/driver/portal"
                  className={linkClass("/driver/portal")}
                >
                  Driver portal
                </Link>
              </>
            )}

            <Link href="/about" className={linkClass("/about")}>
              About
            </Link>
          </nav>
        </div>

        {/* RIGHT: User / Auth */}
        <div className="flex items-center gap-3">
          {status === "loading" ? null : session ? (
            <>
              {/* Profile pill */}
              <Link
                href="/rider/profile"
                className="hidden items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 sm:inline-flex"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                  {initials || "U"}
                </span>
                <span>{rawName}</span>
              </Link>

              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => signIn()}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
