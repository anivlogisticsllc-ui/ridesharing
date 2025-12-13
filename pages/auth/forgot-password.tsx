// pages/auth/forgot-password.tsx
import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      setError("Unable to process request.");
      return;
    }

    const data = await res.json();
    setUserExists(data.userExists);
    setSubmitted(true);
  }

  // Auto redirect depending on existence
  useEffect(() => {
    if (!submitted) return;

    const timer = setTimeout(() => {
      if (userExists) {
        router.push("/auth/login");
      } else {
        router.push("/membership");
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [submitted, userExists, router]);

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
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Forgot Password</h1>

        {submitted ? (
          <>
            {userExists ? (
              <>
                <p style={{ color: "#16a34a", marginBottom: 12 }}>
                  If this email exists, we sent a reset link.
                </p>
                <p style={{ fontSize: 13, color: "#666" }}>
                  Redirecting to sign-in…
                </p>
              </>
            ) : (
              <>
                <p style={{ color: "#b00020", marginBottom: 12 }}>
                  No account found for this email.
                </p>
                <p style={{ fontSize: 13, color: "#666" }}>
                  Redirecting to create an account…
                </p>
              </>
            )}
          </>
        ) : (
          <>
            {error && (
              <p style={{ color: "#b00020", marginBottom: 12 }}>{error}</p>
            )}

            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", marginBottom: 8 }}>
                Email
              </label>

              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  marginBottom: 16,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                }}
              />

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
                Send reset link
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
