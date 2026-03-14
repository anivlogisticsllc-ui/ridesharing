// OATH: Clean replacement file
// FILE: components/Header.tsx

"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

type Role = "RIDER" | "DRIVER" | "ADMIN";

type NotificationMetadata = {
  disputeId?: string;
  bookingId?: string;
  rideId?: string;
} | null;

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  rideId: string | null;
  bookingId: string | null;
  metadata: unknown;
};

type NotificationsApiResponse =
  | {
      ok: true;
      unreadCount: number;
      notifications: NotificationItem[];
    }
  | { ok: false; error: string };

type SessionUserLike = {
  role?: unknown;
  name?: string | null;
  email?: string | null;
};

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
    disputes: "/rider/disputes",
  },

  driver: {
    portal: "/driver/portal",
    dashboard: "/driver/dashboard",
    profile: "/driver/profile",
    payments: "/driver/payments",
    payouts: "/driver/payouts",
    disputes: "/driver/disputes",
  },

  admin: {
    home: "/admin",
    metrics: "/admin/metrics",
    users: "/admin/users",
    riders: "/admin/riders",
    disputes: "/admin/disputes",
  },
} as const;

function formatRelative(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";

  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString();
}

function isDisputeNotification(type: string) {
  return (
    type === "DISPUTE_OPENED" ||
    type === "DISPUTE_STATUS_UPDATED" ||
    type === "DISPUTE_RESOLVED_RIDER" ||
    type === "DISPUTE_RESOLVED_DRIVER"
  );
}

function asNotificationMetadata(value: unknown): NotificationMetadata {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  return {
    disputeId: typeof obj.disputeId === "string" ? obj.disputeId : undefined,
    bookingId: typeof obj.bookingId === "string" ? obj.bookingId : undefined,
    rideId: typeof obj.rideId === "string" ? obj.rideId : undefined,
  };
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();

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

  function notificationHref(n: NotificationItem) {
    const metadata = asNotificationMetadata(n.metadata);

    if (n.type === "CASH_UNPAID_FALLBACK_CHARGED" && n.bookingId) {
      return `/rider/disputes/${encodeURIComponent(n.bookingId)}`;
    }

    if (isDisputeNotification(n.type)) {
      if (isAdmin && metadata?.disputeId) {
        return `/admin/disputes/${encodeURIComponent(metadata.disputeId)}`;
      }

      if (isDriver && n.bookingId) {
        return `/driver/disputes/${encodeURIComponent(n.bookingId)}`;
      }

      if (isRider && n.bookingId) {
        return `/rider/disputes/${encodeURIComponent(n.bookingId)}`;
      }

      if (isAdmin) {
        return ROUTES.admin.disputes;
      }
    }

    if (n.bookingId) return `/receipt/${n.bookingId}`;
    if (n.rideId) return `/rider/trips/${n.rideId}`;

    if (isAdmin) return ROUTES.admin.home;
    if (isDriver) return ROUTES.driver.portal;
    return ROUTES.rider.portal;
  }

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  async function loadNotifications() {
    if (!session) return;

    try {
      setNotifLoading(true);

      const res = await fetch("/api/notifications?take=8", {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as NotificationsApiResponse | null;

      if (!res.ok || !json || !json.ok) return;

      const unreadOnly = json.notifications.filter((n) => !n.readAt);

      setNotifications(unreadOnly);
      setUnreadCount(json.unreadCount);
    } catch (err) {
      console.error("[header] load notifications failed:", err);
    } finally {
      setNotifLoading(false);
    }
  }

  async function markNotificationRead(id: string) {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error("[header] mark notification read failed:", err);
    }
  }

  async function markAllNotificationsRead() {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });

      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("[header] mark all notifications read failed:", err);
    }
  }

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      const el = menuRef.current;
      if (!el) return;

      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
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

  useEffect(() => {
    function onPopState() {
      setOpen(false);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    void loadNotifications();

    const id = window.setInterval(() => {
      void loadNotifications();
    }, 30000);

    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (!open || !session) return;
    void loadNotifications();
  }, [open, session]);

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

  async function handleNotificationClick(n: NotificationItem) {
    const wasUnread = !n.readAt;

    await markNotificationRead(n.id);

    setNotifications((prev) => prev.filter((item) => item.id !== n.id));

    if (wasUnread) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    setOpen(false);
    router.push(notificationHref(n));
  }

  return (
    <header className="relative z-50 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link
            href={ROUTES.home}
            className="flex items-center gap-2"
            onClick={closeMenu}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              R
            </div>
            <span className="text-sm font-semibold text-slate-900">RideShare</span>
          </Link>

          <nav className="ml-4 hidden gap-4 md:flex">
            <Link
              href={ROUTES.home}
              className={linkClass(ROUTES.home)}
              onClick={closeMenu}
            >
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

            <Link
              href={ROUTES.about}
              className={linkClass(ROUTES.about)}
              onClick={closeMenu}
            >
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
                <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                  {initials || "U"}

                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                </span>

                <span className="max-w-[180px] truncate">{rawName}</span>
                <span className="text-[10px] text-slate-500">▾</span>
              </button>

              {open ? (
                <div
                  role="menu"
                  className="absolute right-0 z-[9999] mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                >
                  <div className="px-3 py-2">
                    <div className="truncate text-xs font-semibold text-slate-900">
                      {rawName}
                    </div>
                    <div className="text-[11px] text-slate-500">Role: {roleLabel}</div>
                  </div>

                  <div className="h-px bg-slate-200" />

                  <div className="px-3 py-2">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Notifications
                      </div>

                      {unreadCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => void markAllNotificationsRead()}
                          className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Mark all read
                        </button>
                      ) : null}
                    </div>

                    {notifLoading ? (
                      <div className="py-2 text-xs text-slate-500">Loading…</div>
                    ) : notifications.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        No notifications yet.
                      </div>
                    ) : (
                      <div className="max-h-72 space-y-2 overflow-y-auto">
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => void handleNotificationClick(n)}
                            className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left transition hover:bg-rose-100"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-900">
                                  {n.title}
                                </div>
                                <div className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                                  {n.message}
                                </div>
                              </div>

                              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-600" />
                            </div>

                            <div className="mt-2 text-[10px] text-slate-400">
                              {formatRelative(n.createdAt)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
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
                        <MenuLink href={ROUTES.admin.disputes} onClick={closeMenu}>
                          Disputes
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
                          Driver Payments
                        </MenuLink>
                        <MenuLink href={ROUTES.driver.payouts} onClick={closeMenu}>
                          Driver Payouts
                        </MenuLink>
                        <MenuLink href={ROUTES.driver.disputes} onClick={closeMenu}>
                          Driver disputes
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
                          Rider Payments
                        </MenuLink>
                        <MenuLink href={ROUTES.rider.disputes} onClick={closeMenu}>
                          Rider disputes
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
