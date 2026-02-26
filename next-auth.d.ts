// types/next-auth.d.ts
import "next-auth";
import "next-auth/jwt";

type AppUserRole = "RIDER" | "DRIVER" | "ADMIN";
type AppAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppUserRole;
      isAdmin: boolean;
      accountStatus: AppAccountStatus;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: AppUserRole;
    isAdmin?: boolean;
    accountStatus?: AppAccountStatus;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: AppUserRole;
    isAdmin?: boolean;
    accountStatus?: AppAccountStatus;
  }
}