// lib/appUrl.ts
export function getAppUrl() {
  // 1) explicit canonical
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (explicit) return explicit.replace(/\/$/, "");

  // 2) Vercel fallback (gives "myproj.vercel.app")
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  // 3) last resort for local dev
  return "http://localhost:3000";
}