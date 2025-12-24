// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import Providers from "./providers";
import { Header } from "@/components/Header";
import { HideIfEmbedded } from "@/components/HideIfEmbedded";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RideShare",
  description: "Membership-based community ridesharing platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen bg-slate-50 text-slate-900">
            <HideIfEmbedded>
              <Header />
            </HideIfEmbedded>

            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
