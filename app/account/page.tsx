"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { computeMembershipState, formatDate, type MeMembership } from "@/lib/membership";

type Role = "RIDER" | "DRIVER";

type MePayload =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: "RIDER" | "DRIVER";
        onboardingCompleted: boolean;
      };
      membership: MeMembership;
    }
  | { ok: false; error: string };

type NormalizedMe = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
    onboardingCompleted: boolean;
  };
  membership: MeMembership;
};

function normalizeMe(raw: MePayload): NormalizedMe {
  if (!raw || raw.ok !== true) throw new Error((raw as any)?.error || "Could not load account.");

  // IMPORTANT: we’re removing BOTH from the product behavior.
  // If any stale token says BOTH, treat it as DRIVER to avoid forcing rider setup.
  const roleRaw = raw.user.role;
  const role: Role = roleRaw === "RIDER" ? "RIDER" : "DRIVER";

  return {
    user: {
      id: raw.user.id,
      name: raw.user.name ?? null,
      email: raw.user.email,
      role,
      onboardingCompleted: Boolean(raw.user.onboardingCompleted),
    },
    membership: raw.membership,
  };
}

export default function AccountPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [me, setMe] = useState<NormalizedMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/account");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as MePayload | null;

        if (!res.ok || !json) throw new Error((json as any)?.error || `Failed to load account (HTTP ${res.status})`);

        const normalized = normalizeMe(json);

        if (!cancelled) setMe(normalized);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load account.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router, session, status]);

  const role: Role = me?.user.role ?? (((session?.user as any)?.role as Role) || "RIDER");

  const displayName = me?.user.name || (session?.user as any)?.name || session?.user?.email || "User";
  const email = me?.user.email || session?.user?.email || "";

  const membership = me?.membership;
  const membershipView = computeMembershipState(membership);

  const trialLabel = useMemo(() => {
    if (!membership?.trialEndsAt) return null;
    return formatDate(membership.trialEndsAt);
  }, [membership?.trialEndsAt]);

  if (status === "loading" || loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-600">Loading account…</p>
      </main>
    );
  }

  if (error || !me) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-slate-900">Account</h1>
        <p className="mt-3 text-sm text-rose-600">{error || "Failed to load account."}</p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Back
          </button>
        </div>
      </main>
    );
  }

  const profileLink = role === "DRIVER" ? "/driver/profile" : "/rider/profile";

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Account</h1>
        <p className="mt-1 text-sm text-slate-600">Profile + membership status + quick links.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{displayName}</p>
            <p className="mt-1 text-sm text-slate-600">{email}</p>
            <p className="mt-1 text-xs text-slate-500">Role: {role}</p>
          </div>

          <Link
            href="/billing/membership"
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Membership &amp; billing
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Membership</h2>

        <div className="mt-3">
          {membership && membership.active ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <p className="font-semibold">{membershipView.label}</p>
              <p className="mt-1 text-xs text-emerald-900/90">
                Plan: {membership.plan || "—"}
                {membershipView.endsAtLabel ? ` • Ends: ${membershipView.endsAtLabel}` : ""}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">{membershipView.label}</p>
              <p className="mt-1 text-xs text-amber-900/90">
                {trialLabel ? `Trial ends: ${trialLabel}` : "No trial information available yet."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Quick links</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {role === "DRIVER" ? (
            <>
              <Link href="/driver/portal" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Driver portal
              </Link>
              <Link href="/driver/dashboard" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Driver dashboard
              </Link>
              <Link href={profileLink} className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Driver profile
              </Link>
            </>
          ) : (
            <>
              <Link href="/rider/portal" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Rider portal
              </Link>
              <Link href={profileLink} className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Rider profile
              </Link>
            </>
          )}

          <Link href="/billing/membership" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
            Manage membership
          </Link>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Devil’s advocate: keep “Profile” separate from “Portal”. Portal is operations; profile is identity + billing + docs.
        </p>
      </section>
    </main>
  );
}
