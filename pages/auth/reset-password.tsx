// pages/auth/reset-password.tsx
import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = String(router.query.token || "");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Unable to reset password.");
      return;
    }

    setDone(true);
  }

  // Auto-redirect 5 seconds after success
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => {
        router.push("/auth/login");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [done, router]);

  if (!token) {
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
        <p>Invalid reset link.</p>
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
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 8,
          padding: 24,
          maxWidth: 400,
          width: "100%",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Reset Password</h1>

        {done ? (
          <>
            <p style={{ color: "#16a34a" }}>
              Your password has been updated. You may now{" "}
              <a href="/auth/login" style={{ color: "#2563eb" }}>
                sign in
              </a>
              .
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
              Redirecting you to the sign-in page…
            </p>
          </>
        ) : (
          <>
            {error && (
              <p style={{ color: "#b00020", marginBottom: 12 }}>{error}</p>
            )}

            <form onSubmit={handleSubmit}>
              {/* New password */}
              <label style={{ display: "block", marginBottom: 8 }}>
                New password
              </label>
              <div
                style={{
                  position: "relative",
                  marginBottom: 16,
                }}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 40px 8px 10px",
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

              {/* Confirm password */}
              <label style={{ display: "block", marginBottom: 8 }}>
                Confirm new password
              </label>
              <div
                style={{
                  position: "relative",
                  marginBottom: 16,
                }}
              >
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 40px 8px 10px",
                    borderRadius: 4,
                    border: "1px solid #ccc",
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
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
                    {showConfirmPassword ? "🙈" : "👁️"}
                  </span>
                </button>
              </div>

              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 4,
                  border: "none",
                  fontWeight: 600,
                }}
              >
                Reset password
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
