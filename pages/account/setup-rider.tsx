// pages/account/setup-rider.tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER";

function asRole(v: any): Role | null {
  return v === "RIDER" || v === "DRIVER" ? v : null;
}

export default function RiderSetupPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = asRole((session?.user as any)?.role);

  const displayName = useMemo(() => {
    const name = (session?.user as any)?.name as string | undefined;
    const email = session?.user?.email;
    return (name && name.trim()) || (email ? email.split("@")[0] : "");
  }, [session]);

  // Guard: must be signed in + must be RIDER
  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/account/setup-rider");
      return;
    }

    if (!role) {
      router.replace("/account");
      return;
    }

    if (role !== "RIDER") {
      router.replace("/account/setup-driver");
    }
  }, [session, status, role, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    const formData = new FormData(e.currentTarget);

    const addressLine1 = String(formData.get("addressLine1") || "").trim();
    const city = String(formData.get("city") || "").trim();
    const state = String(formData.get("state") || "").trim();
    const postalCode = String(formData.get("postalCode") || "").trim();
    const country = String(formData.get("country") || "US").trim();

    if (!addressLine1 || !city || !state || !postalCode) {
      setError("Please fill in all required address fields.");
      return;
    }

    const payload = {
      addressLine1,
      addressLine2: String(formData.get("addressLine2") || "").trim() || null,
      city,
      state,
      postalCode,
      country,
    };

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/account/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          (data?.error && typeof data.error === "string" && data.error) ||
          "Something went wrong while saving your profile.";
        setError(msg);
        setIsSubmitting(false);
        return;
      }

      const redirectTo =
        (data?.redirectTo && typeof data.redirectTo === "string" && data.redirectTo) ||
        "/billing/membership";

      router.push(redirectTo);
    } catch {
      setError("Network error. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (status === "loading" || !session || role !== "RIDER") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#6b7280",
          fontSize: 14,
        }}
      >
        Loading…
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          border: "1px solid #ccc",
          borderRadius: 4,
          padding: 24,
          maxWidth: 520,
          width: "100%",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Rider account setup
        </h1>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          To use the platform, we need your basic address information. Your name from registration is shown below and can be updated later.
        </p>

        {error && (
          <div style={{ marginBottom: 12, color: "red", fontSize: 14 }}>
            {error}
          </div>
        )}

        {displayName && (
          <section
            style={{
              marginBottom: 16,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 6,
              background: "#fafafa",
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#333" }}>
              Profile
            </h2>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: "#666" }}>Name</span>
              <span style={{ fontWeight: 600 }}>{displayName}</span>
            </div>
            <p style={{ marginTop: 4, fontSize: 11, color: "#777" }}>
              This name comes from your account registration.
            </p>
          </section>
        )}

        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 8 }}>
          Address
        </h2>

        <div style={{ marginBottom: 10 }}>
          <label htmlFor="addressLine1" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Address line 1 *
          </label>
          <input
            id="addressLine1"
            name="addressLine1"
            type="text"
            required
            style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label htmlFor="addressLine2" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Address line 2 (optional)
          </label>
          <input
            id="addressLine2"
            name="addressLine2"
            type="text"
            style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, marginBottom: 10 }}>
          <div>
            <label htmlFor="city" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              City *
            </label>
            <input
              id="city"
              name="city"
              type="text"
              required
              style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>
          <div>
            <label htmlFor="state" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              State *
            </label>
            <input
              id="state"
              name="state"
              type="text"
              required
              style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div>
            <label htmlFor="postalCode" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              ZIP / Postal code *
            </label>
            <input
              id="postalCode"
              name="postalCode"
              type="text"
              required
              style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>
          <div>
            <label htmlFor="country" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              Country
            </label>
            <input
              id="country"
              name="country"
              type="text"
              defaultValue="US"
              style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: "100%",
            padding: "9px 0",
            borderRadius: 4,
            border: "1px solid #333",
            background: isSubmitting ? "#eee" : "#f5f5f5",
            cursor: isSubmitting ? "default" : "pointer",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {isSubmitting ? "Saving..." : "Continue to membership"}
        </button>
      </form>
    </main>
  );
}
