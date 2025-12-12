"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type DriverProfileResponse = {
  ok: boolean;
  user: {
    role: "RIDER" | "DRIVER" | "BOTH";
    onboardingCompleted: boolean;
    onboardingStep: number | null;
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
    } | null;
  };
};

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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard step: 1 = Identity, 2 = License, 3 = Vehicle
  const [step, setStep] = useState<number>(1);

  // Identity
  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(""); // yyyy-mm-dd

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
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/driver/profile");
        if (res.status === 401) {
          // Not logged in
          router.replace("/auth/login?callbackUrl=/driver/setup");
          return;
        }

        const data = (await res.json()) as DriverProfileResponse;

        if (!data.ok || !data.user) {
          setError("Failed to load driver profile.");
          return;
        }

        const user = data.user;

        // If not a driver at all, send them away
        if (user.role !== "DRIVER" && user.role !== "BOTH") {
          router.replace("/");
          return;
        }

        if (user.onboardingCompleted) {
          router.replace("/driver/portal");
          return;
        }

        setStep(user.onboardingStep || 1);

        const p = user.driverProfile;
        if (p) {
          setLegalName(p.legalName ?? "");
          setDateOfBirth(p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "");

          setLicenseNumber(p.driverLicenseNumber ?? "");
          setLicenseState(p.driverLicenseState ?? "");
          setLicenseExpiry(
            p.driverLicenseExpiry ? p.driverLicenseExpiry.slice(0, 10) : ""
          );

          setVehicleMake(p.vehicleMake ?? "");
          setVehicleModel(p.vehicleModel ?? "");
          setVehicleYear(p.vehicleYear ? String(p.vehicleYear) : "");
          setVehicleColor(p.vehicleColor ?? "");
          setPlateNumber(p.plateNumber ?? "");
          setPlateState(p.plateState ?? "");
        }
      } catch (err) {
        console.error("Error loading driver onboarding profile:", err);
        setError("Unexpected error while loading driver profile.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  const goNext = () => setStep((s) => Math.min(3, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payload: ProfileUpdateBody = {
        onboardingStep: step,
        legalName,
        dateOfBirth: dateOfBirth || undefined,
        driverLicenseNumber: licenseNumber,
        driverLicenseState: licenseState,
        driverLicenseExpiry: licenseExpiry || undefined,
        vehicleMake,
        vehicleModel,
        vehicleYear: vehicleYear ? Number(vehicleYear) : null,
        vehicleColor,
        plateNumber,
        plateState,
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

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to save driver profile.");
      }

      if (step < 3) {
        goNext();
      } else {
        router.replace("/driver/portal");
      }
    } catch (err: any) {
      console.error("Error saving onboarding:", err);
      setError(err.message || "Failed to save driver onboarding.");
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
        <h1 className="text-2xl font-semibold text-slate-900">
          Driver onboarding
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Before you start accepting rides, we need a few details about you and
          your car.
        </p>

        {/* Step indicator */}
        <div className="mt-4 flex gap-2 text-xs font-medium text-slate-600">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 rounded-full px-2 py-1 text-center ${
                s === step
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              Step {s}
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          {/* Step 1 – Identity */}
          {step === 1 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">
                Step 1 – Identity
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Legal name
                  </label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Use the same name that appears on your driver&apos;s
                    license and insurance.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Date of birth
                  </label>
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

          {/* Step 2 – License */}
          {step === 2 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">
                Step 2 – Driver&apos;s license
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    License number
                  </label>
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
                    <label className="block text-xs font-medium text-slate-700">
                      Issuing state / region
                    </label>
                    <input
                      type="text"
                      value={licenseState}
                      onChange={(e) => setLicenseState(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Expiration date
                    </label>
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

          {/* Step 3 – Vehicle */}
          {step === 3 && (
            <>
              <h2 className="text-sm font-semibold text-slate-800">
                Step 3 – Vehicle
              </h2>
              <div className="space-y-3">
                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Make
                    </label>
                    <input
                      type="text"
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Model
                    </label>
                    <input
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-full md:w-24">
                    <label className="block text-xs font-medium text-slate-700">
                      Year
                    </label>
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
                    <label className="block text-xs font-medium text-slate-700">
                      Color
                    </label>
                    <input
                      type="text"
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="md:flex-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Plate number
                    </label>
                    <input
                      type="text"
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-full md:w-24">
                    <label className="block text-xs font-medium text-slate-700">
                      Plate state
                    </label>
                    <input
                      type="text"
                      value={plateState}
                      onChange={(e) => setPlateState(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-slate-500">
                  In a later version we&apos;ll add document upload and
                  automated verification. For now this is a simple profile used
                  for matching and receipts.
                </p>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-rose-600">{error}</p>
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
              {saving
                ? "Saving…"
                : step === 3
                ? "Finish setup"
                : "Save & continue"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
