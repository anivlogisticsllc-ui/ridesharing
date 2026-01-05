"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | string;

type DriverProfile = {
  // identity
  legalName: string | null;
  dateOfBirth: string | null;

  // license
  driverLicenseNumber: string | null;
  driverLicenseState: string | null;
  driverLicenseExpiry: string | null;

  // vehicle
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleColor: string | null;
  plateNumber: string | null;
  plateState: string | null;

  // verification
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
};

type DriverProfileApiResponse =
  | {
      ok: true;
      user: {
        role: "RIDER" | "DRIVER";
        onboardingCompleted: boolean;
        onboardingStep: number | null;
      };
      driverProfile: (DriverProfile & { createdAt?: string; updatedAt?: string }) | null;
    }
  | { ok: false; error: string };

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-[180px_1fr] md:gap-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: VerificationStatus }) {
  const base = "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium";

  if (status === "APPROVED") {
    return (
      <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        Verified
      </span>
    );
  }

  if (status === "REJECTED") {
    return (
      <span className={`${base} border-rose-200 bg-rose-50 text-rose-700`}>
        Rejected
      </span>
    );
  }

  return (
    <span className={`${base} border-amber-200 bg-amber-50 text-amber-900`}>
      Pending
    </span>
  );
}

function isMissingVehicle(p: DriverProfile | null) {
  if (!p) return true;
  return (
    !p.vehicleMake ||
    !p.vehicleModel ||
    p.vehicleYear == null ||
    !p.vehicleColor ||
    !p.plateNumber ||
    !p.plateState
  );
}

function isMissingIdentity(p: DriverProfile | null) {
  if (!p) return true;
  return !p.legalName || !p.dateOfBirth;
}

export default function DriverProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<DriverProfileApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);

        const res = await fetch("/api/driver/profile", { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/auth/login?callbackUrl=/driver/profile");
          return;
        }

        const json = (await res.json()) as DriverProfileApiResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) {
          setData({ ok: false, error: e?.message || "Failed to load driver profile." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const profile = data && data.ok ? data.driverProfile : null;
  const verificationStatus: VerificationStatus = profile?.verificationStatus ?? "PENDING";

  const headerPill = useMemo(() => {
    if (!data || !data.ok) return null;
    return <StatusPill status={verificationStatus} />;
  }, [data, verificationStatus]);

  const editHref = useMemo(() => {
    if (isMissingVehicle(profile)) return "/driver/setup?step=3";
    if (isMissingIdentity(profile)) return "/driver/setup?step=1";
    return "/driver/setup?step=2";
  }, [profile]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-600">Loading driver profile…</p>
      </main>
    );
  }

  if (!data || !data.ok) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Driver profile</h1>
          <p className="mt-3 text-sm text-rose-600">{data?.error || "Could not load driver profile."}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
              Home
            </Link>
            <Link
              href="/driver/portal"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Driver portal
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Driver profile</h1>
          <p className="mt-2 text-sm text-slate-600">
            You don’t have a driver profile yet. Complete driver setup to add your identity, license, and vehicle info.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/driver/setup?step=1"
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Start driver setup
            </Link>

            <Link
              href="/driver/portal"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Driver portal
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const status = verificationStatus;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Driver profile</h1>
          <p className="mt-1 text-sm text-slate-600">
            This shows the driver info collected during onboarding. Use “Edit / update” to change it.
          </p>

          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-700">
                <span className="font-medium">Verification:</span>{" "}
                <span className="uppercase">{String(status)}</span>
              </div>
              {headerPill}
            </div>

            {status === "PENDING" && (
              <p className="text-sm text-slate-600">
                Your driver documents are under review. You can’t accept or start rides until approved.
              </p>
            )}

            {status === "REJECTED" && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-800">
                  Verification rejected. Please update your info and resubmit.
                </p>
                {profile.verificationNotes ? (
                  <p className="mt-2 text-sm text-rose-800/90">Reason: {profile.verificationNotes}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Identity</h2>
          <Row label="Legal name" value={profile.legalName ?? "—"} />
          <Row label="Date of birth" value={fmtDate(profile.dateOfBirth)} />
        </div>

        <div className="h-px bg-slate-200" />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Driver’s license</h2>
          <Row label="License number" value={profile.driverLicenseNumber ?? "—"} />
          <Row label="Issuing state" value={profile.driverLicenseState ?? "—"} />
          <Row label="Expiry date" value={fmtDate(profile.driverLicenseExpiry)} />
        </div>

        <div className="h-px bg-slate-200" />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Vehicle</h2>
          <Row label="Make" value={profile.vehicleMake ?? "—"} />
          <Row label="Model" value={profile.vehicleModel ?? "—"} />
          <Row label="Year" value={profile.vehicleYear ?? "—"} />
          <Row label="Color" value={profile.vehicleColor ?? "—"} />
          <Row label="Plate" value={profile.plateNumber ?? "—"} />
          <Row label="Plate state" value={profile.plateState ?? "—"} />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href={editHref}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Edit / update info
          </Link>

          <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
            Home
          </Link>

          <Link
            href="/driver/portal"
            className="rounded-full border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Driver portal
          </Link>
        </div>

        <p className="text-xs text-slate-500">
          Viewing your profile is always allowed. Verification controls accepting and starting rides.
        </p>
      </section>
    </main>
  );
}
