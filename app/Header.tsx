"use client";

import Link from "next/link";
import { useSession, signIn, signOut } from "next-auth/react";

export function Header() {
  const { data: session, status } = useSession();
  const userRole = (session?.user as any)?.role as
    | "RIDER"
    | "DRIVER"
    | undefined;

  const isRider = userRole === "RIDER";
  const isDriver = userRole === "DRIVER";

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              R
            </div>
            <span className="text-sm font-semibold text-slate-900">
              RideShare
            </span>
          </Link>

          <nav className="ml-4 hidden gap-4 text-xs font-medium text-slate-600 md:flex">
            <Link href="/" className="hover:text-slate-900">
              Home
            </Link>

            <Link href="/routes" className="hover:text-slate-900">
              Routes &amp; Rates
            </Link>

            {/* Membership only for guests */}
            {!session && (
              <Link href="#membership-plans" className="hover:text-slate-900">
                Membership
              </Link>
            )}

            {/* Rider-only portal */}
            {isRider && (
              <Link href="/rider/portal" className="hover:text-slate-900">
                Rider portal
              </Link>
            )}

            {/* Driver-only: dashboard + portal */}
            {isDriver && (
              <>
                <Link
                  href="/driver"
                  className="hover:text-slate-900"
                >
                  Driver dashboard
                </Link>
                <Link
                  href="/driver/portal"
                  className="hover:text-slate-900"
                >
                  Driver portal
                </Link>
              </>
            )}

            <Link href="/about" className="hover:text-slate-900">
              About
            </Link>
          </nav>
        </div>

        {/* Right: auth */}
        <div className="flex items-center gap-3">
          {status === "loading" ? null : session ? (
            <>
              <span className="hidden text-xs text-slate-600 sm:inline">
                {(session.user as any)?.name || session.user?.email}
              </span>
              <button
                onClick={() => signOut()}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
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
