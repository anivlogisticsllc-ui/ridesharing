// app/driver/setup/page.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type DriverProfileResponse =
  | {
      ok: true;
      user: {
        role: "RIDER" | "DRIVER";
        onboardingCompleted: boolean;
        onboardingStep: number | null;
      };
      driverProfile: {
        legalName: string | null;
        dateOfBirth: string | null;

        driverLicenseNumber: string | null;
        driverLicenseState: string | null;
        driverLicenseExpiry: string | null;

        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: number | null;
        vehicleColor: string | null;
        plateNumber: string | null;
        plateState: string | null;

        verificationStatus?: string;
        verificationNotes?: string | null;
      } | null;
    }
  | { ok: false; error: string };

type ProfileUpdateBody = {
  onboardingCompleted?: boolean;
  onboardingStep?: number;

  legalName?: string;
  dateOfBirth?: string;

  driverLicenseNumber?: string;
  driverLicenseState?: string;
  driverLicenseExpiry?: string;

  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number | null;
  vehicleColor?: string;
  plateNumber?: string;
  plateState?: string;
};

export default function DriverSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const forcedStep = useMemo(() => {
    const raw = searchParams.get("step");
    const n = raw ? Number(raw) : NaN;
    return n === 1 || n === 2 || n === 3 ? n : null;
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<number>(1);

  // Identity
  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  // License
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");

  // Vehicle
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [plateState, setPlateState] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/driver/profile", { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/auth/login?callbackUrl=/driver/setup");
          return;
        }

        const data = (await res.json()) as DriverProfileResponse;

        if (!data || data.ok === false) {
          if (!cancelled) setError((data as any)?.error || "Failed to load driver profile.");
          return;
        }

        const user = data.user;
        if (user.role !== "DRIVER") {
          router.replace("/");
          return;
        }

        // Allow edits even if onboardingCompleted is true
        const initialStep = forcedStep ?? user.onboardingStep ?? 1;
        if (!cancelled) setStep(initialStep);

        const p = data.driverProfile;
        if (p && !cancelled) {
          setLegalName(p.legalName ?? "");
          setDateOfBirth(p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "");

          setLicenseNumber(p.driverLicenseNumber ?? "");
          setLicenseState(p.driverLicenseState ?? "");
          setLicenseExpiry(p.driverLicenseExpiry ? p.driverLicenseExpiry.slice(0, 10) : "");

          setVehicleMake(p.vehicleMake ?? "");
          setVehicleModel(p.vehicleModel ?? "");
          setVehicleYear(p.vehicleYear ? String(p.vehicleYear) : "");
          setVehicleColor(p.vehicleColor ?? "");
          setPlateNumber(p.plateNumber ?? "");
          setPlateState(p.plateState ?? "");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unexpected error while loading driver profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router, forcedStep]);

  const goNext = () => setStep((s) => Math.min(3, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payload: ProfileUpdateBody = {
        onboardingStep: step,

        legalName: legalName.trim(),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        driverLicenseNumber: licenseNumber.trim(),
        driverLicenseState: licenseState.trim(),
        driverLicenseExpiry: licenseExpiry || undefined,

        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleYear: vehicleYear ? Number(vehicleYear) : null,
        vehicleColor: vehicleColor.trim(),
        plateNumber: plateNumber.trim(),
        plateState: plateState.trim(),
      };

      if (step === 3) {
        payload.onboardingCompleted = true;
        payload.onboardingStep = 3;
      }

      const res = await fetch("/api/driver/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 401) {
        router.replace("/auth/login?callbackUrl=/driver/setup");
        return;
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to save driver profile.");
      }

      if (step < 3) {
        goNext();
      } else {
        router.replace("/billing/membership");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save driver setup.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading driver setup…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Driver setup</h1>
        <p className="mt-1 text-sm text-slate-600">Update your identity, license, and vehicle details.</p>

        <div className="mt-4 flex gap-2 text-xs font-medium text-slate-600">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 rounded-full px-2 py-1 text-center ${
                s === step ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700"
              }`}
            >
              Step {s}
            </div>
          ))}
        </div>

        {error ? <p className="mt-4 text-xs text-rose-600">{error}</p> : null}

        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          {step === 1 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">Step 1 – Identity</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Legal name</label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Date of birth</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">Step 2 – Driver&apos;s license</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">License number</label>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Issuing state</label>
                    <input
                      type="text"
                      value={licenseState}
                      onChange={(e) => setLicenseState(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Expiration date</label>
                    <input
                      type="date"
                      value={licenseExpiry}
                      onChange={(e) => setLicenseExpiry(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">Step 3 – Vehicle</h2>
              <div className="space-y-3">
                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Make</label>
                    <input
                      type="text"
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Model</label>
                    <input
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="w-full md:w-24">
                    <label className="block text-xs font-medium text-slate-700">Year</label>
                    <input
                      type="number"
                      min={1990}
                      max={2100}
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Color</label>
                    <input
                      type="text"
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">Plate number</label>
                    <input
                      type="text"
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="w-full md:w-24">
                    <label className="block text-xs font-medium text-slate-700">Plate state</label>
                    <input
                      type="text"
                      value={plateState}
                      onChange={(e) => setPlateState(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="mt-4 flex justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || saving}
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 disabled:opacity-50"
            >
              Back
            </button>

            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : step === 3 ? "Continue to membership" : "Save & continue"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
