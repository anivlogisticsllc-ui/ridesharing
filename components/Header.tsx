"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

type Role = "RIDER" | "DRIVER" | "ADMIN";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

const ROUTES = {
  home: "/",
  about: "/about",

  account: {
    overview: "/account",
    billing: "/account/billing",
    setupRider: "/account/setup-rider",
    setupDriver: "/account/setup-driver",
  },

  membership: "/billing/membership",

  rider: {
    portal: "/rider/portal",
    profile: "/rider/profile",
    payments: "/rider/payments",
  },

  driver: {
    portal: "/driver/portal",
    dashboard: "/driver/dashboard",
    profile: "/driver/profile",
    payments: "/driver/payments",
    payouts: "/driver/payouts",
  },

  admin: {
    home: "/admin",
    metrics: "/admin/metrics",
    users: "/admin/users",
    riders: "/admin/riders",
  },
} as const;

type SessionUserLike = {
  role?: unknown;
  name?: string | null;
  email?: string | null;
};

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const user = (session?.user as SessionUserLike | undefined) ?? undefined;

  const role = asRole(user?.role);
  const isAdmin = role === "ADMIN";
  const isRider = role === "RIDER";
  const isDriver = role === "DRIVER";

  const rawName = user?.name || user?.email || "Account";

  const initials = useMemo(() => {
    return String(rawName)
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }, [rawName]);

  const linkClass = (href: string) => {
    const isActive = href === "/" ? pathname === "/" : pathname?.startsWith(href);
    return [
      "relative text-xs font-medium transition-colors",
      isActive
        ? "text-slate-900 after:absolute after:left-0 after:-bottom-1 after:h-[2px] after:w-full after:rounded-full after:bg-slate-900"
        : "text-slate-600 hover:text-slate-900",
    ].join(" ");
  };

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close on browser back/forward (counts as an external event callback, lint is fine with it)
  useEffect(() => {
    function onPopState() {
      setOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const profileHref = isDriver
    ? ROUTES.driver.profile
    : isRider
    ? ROUTES.rider.profile
    : ROUTES.account.overview;

  const roleLabel = role ?? "—";

  function handleSignOut() {
    setOpen(false);
    signOut({ callbackUrl: ROUTES.home });
  }

  function closeMenu() {
    setOpen(false);
  }

  return (
    <header className="relative z-50 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href={ROUTES.home} className="flex items-center gap-2" onClick={closeMenu}>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              R
            </div>
            <span className="text-sm font-semibold text-slate-900">RideShare</span>
          </Link>

          <nav className="ml-4 hidden gap-4 md:flex">
            <Link href={ROUTES.home} className={linkClass(ROUTES.home)} onClick={closeMenu}>
              Home
            </Link>

            {session && isRider && (
              <Link
                href={ROUTES.rider.portal}
                className={linkClass(ROUTES.rider.portal)}
                onClick={closeMenu}
              >
                Rider portal
              </Link>
            )}

            {session && isDriver && (
              <Link
                href={ROUTES.driver.portal}
                className={linkClass(ROUTES.driver.portal)}
                onClick={closeMenu}
              >
                Driver portal
              </Link>
            )}

            {session && isAdmin && (
              <Link
                href={ROUTES.admin.home}
                className={linkClass(ROUTES.admin.home)}
                onClick={closeMenu}
              >
                Admin
              </Link>
            )}

            <Link href={ROUTES.about} className={linkClass(ROUTES.about)} onClick={closeMenu}>
              About
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {status === "loading" ? null : session ? (
            <div className="relative z-[9999]" ref={menuRef}>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="hidden items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 sm:inline-flex"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="User menu"
                title="Account"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                  {initials || "U"}
                </span>
                <span className="max-w-[180px] truncate">{rawName}</span>
                <span className="text-[10px] text-slate-500">▾</span>
              </button>

              {open ? (
                <div
                  role="menu"
                  className="absolute right-0 z-[9999] mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                >
                  <div className="px-3 py-2">
                    <div className="truncate text-xs font-semibold text-slate-900">{rawName}</div>
                    <div className="text-[11px] text-slate-500">Role: {roleLabel}</div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  {isAdmin ? (
                    <>
                      <div className="px-1 py-1">
                        <MenuLink href={ROUTES.admin.home} onClick={closeMenu}>
                          Admin portal
                        </MenuLink>
                        <MenuLink href={ROUTES.admin.metrics} onClick={closeMenu}>
                          Metrics
                        </MenuLink>
                        <MenuLink href={ROUTES.admin.users} onClick={closeMenu}>
                          Users
                        </MenuLink>
                        <MenuLink href={ROUTES.admin.riders} onClick={closeMenu}>
                          Riders
                        </MenuLink>
                      </div>
                      <div className="h-px bg-slate-200" />
                    </>
                  ) : null}

                  <div className="px-1 py-1">
                    <MenuLink href={ROUTES.account.overview} onClick={closeMenu}>
                      Account overview
                    </MenuLink>
                    <MenuLink href={ROUTES.account.billing} onClick={closeMenu}>
                      Account billing
                    </MenuLink>
                    <MenuLink href={profileHref} onClick={closeMenu}>
                      Profile
                    </MenuLink>
                    <MenuLink href={ROUTES.membership} onClick={closeMenu}>
                      Membership billing
                    </MenuLink>
                  </div>

                  {isDriver ? (
                    <>
                      <div className="h-px bg-slate-200" />
                      <div className="px-1 py-1">
                        <MenuLink href={ROUTES.driver.dashboard} onClick={closeMenu}>
                          Driver dashboard
                        </MenuLink>
                        <MenuLink href={ROUTES.driver.portal} onClick={closeMenu}>
                          Driver portal
                        </MenuLink>
                        <MenuLink href={ROUTES.driver.payments} onClick={closeMenu}>
                          Payments (soon)
                        </MenuLink>
                        <MenuLink href={ROUTES.driver.payouts} onClick={closeMenu}>
                          Payouts (soon)
                        </MenuLink>
                      </div>
                    </>
                  ) : null}

                  {isRider ? (
                    <>
                      <div className="h-px bg-slate-200" />
                      <div className="px-1 py-1">
                        <MenuLink href={ROUTES.rider.portal} onClick={closeMenu}>
                          Rider portal
                        </MenuLink>
                        <MenuLink href={ROUTES.rider.payments} onClick={closeMenu}>
                          Payments (soon)
                        </MenuLink>
                      </div>
                    </>
                  ) : null}

                  <div className="h-px bg-slate-200" />

                  <div className="px-1 py-1">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                      role="menuitem"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
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

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}
