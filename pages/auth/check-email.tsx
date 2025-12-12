// pages/auth/check-email.tsx
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function CheckEmail() {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(10);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push("/auth/login");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [router]);

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
          borderRadius: 4,
          padding: 24,
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
          Check your email
        </h1>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          We’ve created your account. Please check your inbox for an activation
          link. After you confirm your email, you’ll continue to membership
          setup.
        </p>
        <p style={{ fontSize: 13, color: "#666" }}>
          You will be redirected to the sign-in page in{" "}
          <strong>{secondsLeft}</strong> seconds.
        </p>
      </div>
    </main>
  );
}
