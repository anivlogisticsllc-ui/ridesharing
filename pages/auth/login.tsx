// pages/auth/login.tsx
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";

type Role = "RIDER" | "DRIVER";

type MeApiResponse =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: Role;
        onboardingCompleted: boolean;
      };
    }
  | { ok: false; error: string };

function safeCallbackUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  return v;
}

function PublicHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              R
            </div>
            <span className="text-sm font-semibold text-slate-900">RideShare</span>
          </Link>

          <nav className="ml-4 hidden gap-4 text-xs font-medium text-slate-600 md:flex">
            <Link href="/" className="hover:text-slate-900">
              Home
            </Link>
            <Link href="/routes" className="hover:text-slate-900">
              Routes &amp; Rates
            </Link>
            <Link href="/about" className="hover:text-slate-900">
              About
            </Link>
          </nav>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <Link
            href="/auth/register"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const callbackUrl = useMemo(
    () => safeCallbackUrl(router.query.callbackUrl),
    [router.query.callbackUrl]
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData(e.currentTarget);
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");

      if (!email || !password) {
        setError("Email and password are required.");
        return;
      }

      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (!result || result.error) {
        setError(
          result?.error === "EmailNotVerified"
            ? "Please verify your email using the link we sent before signing in."
            : "Invalid email or password."
        );
        return;
      }

      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as MeApiResponse | null;

      if (!res.ok || !json) {
        setError("Could not load your profile.");
        return;
      }

      if (!("ok" in json) || json.ok !== true) {
        setError((json as any)?.error || "Could not load your profile.");
        return;
      }

      const { role, onboardingCompleted } = json.user;

      if (!onboardingCompleted) {
        await router.push(role === "DRIVER" ? "/driver/setup" : "/");
        return;
      }

      let target = callbackUrl || (role === "DRIVER" ? "/driver/portal" : "/");

      // guard against sending riders into account pages
      if (role === "RIDER" && target.startsWith("/account")) {
        target = "/";
      }

      await router.push(target);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PublicHeader />

      <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-10">
          <div className="w-full space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
              <p className="text-sm text-slate-600">
                Use the email and password you registered with.
              </p>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-70"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">
                  Password
                </label>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    disabled={isSubmitting}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-70"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={isSubmitting}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <div className="flex justify-end">
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="text-center text-xs text-slate-500">
              Don&apos;t have an account?{" "}
              <Link href="/auth/register" className="font-medium text-indigo-600 hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
