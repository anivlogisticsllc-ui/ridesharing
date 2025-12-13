// pages/auth/login.tsx
import { useState } from "react";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";

type MeResponse = {
  id: string;
  name: string | null;
  email: string;
  role: "RIDER" | "DRIVER" | "BOTH";
  onboardingCompleted: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const callbackUrl =
    typeof router.query.callbackUrl === "string"
      ? router.query.callbackUrl
      : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      setError("Email and password are required.");
      setIsSubmitting(false);
      return;
    }

    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });

    if (!result || result.error) {
      if (result?.error === "EmailNotVerified") {
        setError(
          "Please verify your email using the link we sent before signing in."
        );
      } else {
        setError("Invalid email or password.");
      }
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        setError("Could not load your profile.");
        setIsSubmitting(false);
        return;
      }

      const me = (await res.json()) as MeResponse;

      if (!me.onboardingCompleted) {
        if (me.role === "DRIVER" || me.role === "BOTH") {
          await router.push("/account/setup-driver");
        } else {
          await router.push("/account/setup-rider");
        }
        return;
      }

      // Onboarded: drivers should land on home with available rides
      const target = callbackUrl || "/";
      await router.push(target);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
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
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 8,
          padding: 24,
          maxWidth: 400,
          width: "100%",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          Sign in
        </h1>

        {error && (
          <p
            style={{
              marginBottom: 12,
              color: "#b00020",
              fontSize: 14,
            }}
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="email"
            style={{ display: "block", marginBottom: 8, fontSize: 14 }}
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            style={{
              width: "100%",
              padding: "8px 10px",
              marginBottom: 16,
              borderRadius: 4,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />

          <label
            htmlFor="password"
            style={{ display: "block", marginBottom: 8, fontSize: 14 }}
          >
            Password
          </label>

          {/* Password field with eye icon */}
          <div
            style={{
              position: "relative",
              marginBottom: 8,
            }}
          >
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              style={{
                width: "100%",
                padding: "8px 40px 8px 10px", // extra space on right for icon
                borderRadius: 4,
                border: "1px solid #ccc",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                margin: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                outline: "none",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  lineHeight: 1,
                  color: "#555",
                }}
              >
                {showPassword ? "🙈" : "👁️"}
              </span>
            </button>
          </div>

          {/* Forgot password link */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 20,
            }}
          >
            <a
              href="/auth/forgot-password"
              style={{
                fontSize: 13,
                color: "#2563eb",
                textDecoration: "none",
              }}
            >
              Forgot your password?
            </a>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 4,
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              cursor: isSubmitting ? "default" : "pointer",
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
