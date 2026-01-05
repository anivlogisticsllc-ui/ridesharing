// pages/api/auth/[...nextauth].ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "../../../lib/prisma";
import bcrypt from "bcrypt";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,

  session: { strategy: "jwt" },

  pages: { signIn: "/auth/login" },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@example.com" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();

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
            // ✅ include admin flag
            isAdmin: true,
          },
        });

        if (!user) return null;

        const storedPassword = user.passwordHash;
        if (!storedPassword) return null;

        let isValid = false;
        if (
          storedPassword.startsWith("$2a$") ||
          storedPassword.startsWith("$2b$") ||
          storedPassword.startsWith("$2y$")
        ) {
          isValid = await bcrypt.compare(credentials.password, storedPassword);
        } else {
          isValid = credentials.password === storedPassword;
        }

        if (!isValid) return null;

        if (user.accountStatus === "SUSPENDED") return null;

        if (!user.emailVerified) {
          throw new Error("EmailNotVerified");
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isAdmin: user.isAdmin, // ✅
          accountStatus: user.accountStatus,
        } as any;
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // initial sign-in
      if (user) {
        (token as any).userId = (user as any).id;
        (token as any).role = (user as any).role;
        (token as any).isAdmin = (user as any).isAdmin ?? false; // ✅
        (token as any).accountStatus = (user as any).accountStatus;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        const u = session.user as any;
        u.id = (token as any).userId ?? token.sub;
        u.role = (token as any).role;
        u.isAdmin = (token as any).isAdmin ?? false; // ✅
        u.accountStatus = (token as any).accountStatus;
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
