// pages/api/auth/[...nextauth].ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";

// Keep secrets in env
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;

function isBcryptHash(v: string) {
  return v.startsWith("$2a$") || v.startsWith("$2b$") || v.startsWith("$2y$");
}

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",

  session: { strategy: "jwt" },
  pages: { signIn: "/auth/login" },

  logger: {
    error(code, meta) {
      console.error("[nextauth][error]", code, meta);
    },
    warn(code) {
      console.warn("[nextauth][warn]", code);
    },
    debug(code, meta) {
      if (process.env.NODE_ENV === "development") {
        console.log("[nextauth][debug]", code, meta);
      }
    },
  },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@example.com" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        try {
          const rawEmail = String(credentials?.email ?? "");
          const rawPassword = String(credentials?.password ?? "");

          const email = rawEmail.trim().toLowerCase();
          const password = rawPassword;

          if (!email || !password) return null;

          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              accountStatus: true,
              emailVerified: true,
              passwordHash: true,
              isAdmin: true,
            },
          });

          // Helpful logs while you stabilize auth (don’t log the password)
          if (process.env.NODE_ENV === "development") {
            console.log("[auth] login attempt", { email, found: !!user });
          }

          if (!user) return null;

          // Block access for suspended/disabled users
          if (user.accountStatus === "SUSPENDED" || user.accountStatus === "DISABLED") {
            return null;
          }

          // If emailVerified is null in your DB for legacy users, treat null as "verified"
          // If you want to enforce verification strictly, change this logic and handle the UI message.
          const isVerified = user.emailVerified === null ? true : !!user.emailVerified;
          if (!isVerified) {
            // returning null produces a 401; throwing creates a NextAuth error you can display
            throw new Error("EmailNotVerified");
          }

          const stored = user.passwordHash;
          if (!stored) return null;

          const ok = isBcryptHash(stored)
            ? await bcrypt.compare(password, stored)
            : password === stored;

          if (process.env.NODE_ENV === "development") {
            console.log("[auth] password match", { email, ok, hashType: isBcryptHash(stored) ? "bcrypt" : "plain" });
          }

          if (!ok) return null;

          // NextAuth expects at least an id + email here
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isAdmin: user.isAdmin ?? false,
            accountStatus: user.accountStatus ?? "ACTIVE",
          } as any;
        } catch (err) {
          // Keep a readable server-side error
          console.error("[auth] authorize error", err);
          throw err;
        }
      },
    }),
  ],

// pages/api/auth/[...nextauth].ts (callbacks section)

  callbacks: {
    async jwt({ token, user }) {
      // initial sign-in only
      if (user) {
        const u = user as any;
        (token as any).userId = u.id;
        (token as any).role = u.role;
        (token as any).isAdmin = u.isAdmin ?? false;
        (token as any).accountStatus = u.accountStatus ?? "ACTIVE";

        // keep token.sub aligned to the user id (helps many libs/tools)
        token.sub = String(u.id);
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = (token as any).userId ?? token.sub;
        (session.user as any).role = (token as any).role;
        (session.user as any).isAdmin = (token as any).isAdmin ?? false;
        (session.user as any).accountStatus = (token as any).accountStatus ?? "ACTIVE";
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;
      } catch {}
      return baseUrl;
    },
  },
};

export default NextAuth(authOptions);
