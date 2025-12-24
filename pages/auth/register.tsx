// pages/auth/register.tsx
import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/router";
import { PasswordField } from "@/components/PasswordField";

type RegisterError = string | null;

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<RegisterError>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // plan = "rider" | "driver" | "both"
  const [plan, setPlan] = useState<"rider" | "driver" | "both">("rider");

  // Initialize plan from ?role=RIDER / ?role=DRIVER in the URL
  useEffect(() => {
    if (!router.isReady) return;

    const qRole =
      typeof router.query.role === "string" ? router.query.role : "";

    if (qRole.toUpperCase() === "DRIVER") {
      setPlan("driver");
    } else if (qRole.toUpperCase() === "RIDER") {
      setPlan("rider");
    }
  }, [router.isReady, router.query.role]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Name, email, and password are required.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
          plan, // becomes the role in the API
        }),
      });

      if (!res.ok) {
        let msg = "Could not create account.";

        try {
          const data = await res.json();
          if (data?.error && typeof data.error === "string") {
            msg = data.error;
          }
        } catch {
          // ignore JSON parse error
        }

        setError(msg);
        setIsSubmitting(false);
        return;
      }

      // Registration OK → go to "check your email" page
      await router.push("/auth/check-email");
    } catch {
      setError("Network error. Please try again.");
      setIsSubmitting(false);
    }
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
          borderRadius: 8,
          padding: 24,
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Create an account
        </h1>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          Choose whether you want to ride or drive. You can adjust your plan
          later.
        </p>

        {/* Error message */}
        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 4,
              background: "#fdecea",
              color: "#b00020",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Plan selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Account type</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setPlan("rider")}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 6,
                border:
                  plan === "rider" ? "2px solid #4f46e5" : "1px solid #ccc",
                background: plan === "rider" ? "#eef2ff" : "#fff",
                fontSize: 13,
                fontWeight: plan === "rider" ? 600 : 500,
                cursor: "pointer",
              }}
            >
              Rider
            </button>
            <button
              type="button"
              onClick={() => setPlan("driver")}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 6,
                border:
                  plan === "driver" ? "2px solid #4f46e5" : "1px solid #ccc",
                background: plan === "driver" ? "#eef2ff" : "#fff",
                fontSize: 13,
                fontWeight: plan === "driver" ? 600 : 500,
                cursor: "pointer",
              }}
            >
              Driver
            </button>
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="name"
            style={{ display: "block", fontSize: 13, marginBottom: 4 }}
          >
            Full name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
        </div>

        {/* Email */}
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="email"
            style={{ display: "block", fontSize: 13, marginBottom: 4 }}
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
        </div>

        {/* Phone (optional) */}
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="phone"
            style={{ display: "block", fontSize: 13, marginBottom: 4 }}
          >
            Phone (optional)
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
        </div>

        {/* Password + confirm password */}
        <div style={{ marginBottom: 12 }}>
          <PasswordField
            label="Password"
            name="password"
            autoComplete="new-password"
            showStrength
            onChange={(e) => setPassword(e.target.value)}
          />
          <p style={{ fontSize: 11, color: "#777", marginTop: 4 }}>
            At least 8 characters, ideally with a mix of letters, numbers, and
            symbols.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <PasswordField
            label="Confirm password"
            name="confirmPassword"
            autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 4,
            border: "none",
            background: isSubmitting ? "#ddd" : "#4f46e5",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: isSubmitting ? "default" : "pointer",
          }}
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
