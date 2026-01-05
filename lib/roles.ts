export type Role = "RIDER" | "DRIVER" | "ADMIN";

export function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

export function isDriverOrAdmin(v: unknown) {
  const r = asRole(v);
  return r === "DRIVER" || r === "ADMIN";
}
