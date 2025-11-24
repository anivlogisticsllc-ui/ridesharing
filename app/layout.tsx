// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RideShare",
  description: "Membership-based community ridesharing platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          {/* Top nav */}
          <header className="border-b bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              {/* Logo / brand */}
              <Link href="/" className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
                  R
                </div>
                <span className="text-base font-semibold tracking-tight">
                  RideShare
                </span>
              </Link>

              {/* Nav links */}
              <nav className="hidden items-center gap-5 text-sm text-slate-700 md:flex">
                <Link href="/" className="hover:text-indigo-600">
                  Home
                </Link>
                <Link href="/routes" className="hover:text-indigo-600">
                  Routes &amp; Rates
                </Link>
                <Link href="/membership" className="hover:text-indigo-600">
                  Membership
                </Link>
                <Link href="/driver" className="hover:text-indigo-600">
                  Driver Portal
                </Link>
                <Link href="/about" className="hover:text-indigo-600">
                  About
                </Link>
              </nav>

              {/* Right side actions (placeholder for auth later) */}
              <div className="flex items-center gap-2 text-xs">
                <button className="rounded-full border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100">
                  Sign in
                </button>
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
