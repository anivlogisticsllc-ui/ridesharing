// pages/api/auth/[...nextauth].ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "../../../lib/prisma";
import bcrypt from "bcrypt";
import type { UserRole } from "@prisma/client";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "you@example.com",
        },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // 1) Basic checks
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.toLowerCase().trim();

        // 2) Look up user by email
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          return null;
        }

        // 3) Figure out which field holds the password
        const storedPassword =
          (user as any).passwordHash ?? (user as any).password;

        if (!storedPassword) {
          return null;
        }

        // 4) Check password (bcrypt or plain for dev)
        let isValid = false;

        if (
          typeof storedPassword === "string" &&
          (storedPassword.startsWith("$2a$") ||
            storedPassword.startsWith("$2b$") ||
            storedPassword.startsWith("$2y$"))
        ) {
          isValid = await bcrypt.compare(credentials.password, storedPassword);
        } else {
          isValid = credentials.password === storedPassword;
        }

        if (!isValid) {
          return null;
        }

        // 5) Block suspended accounts
        if ((user as any).accountStatus === "SUSPENDED") {
          return null;
        }

        // 6) Block users who haven't verified their email
        if (!user.emailVerified) {
          // This will surface as result.error = "EmailNotVerified"
          throw new Error("EmailNotVerified");
        }

        // 7) SUCCESS – return the user object
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: (user as any).role,
          accountStatus: (user as any).accountStatus,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        (token as any).role = (user as any).role;
        (token as any).accountStatus = (user as any).accountStatus;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        const u = session.user as any;

        // id comes from token.sub
        u.id = token.sub as string | undefined;
        u.role = (token as any).role as UserRole | undefined;
        u.accountStatus = (token as any).accountStatus;
      }
      return session;
    },

    async redirect({ baseUrl }) {
      // always go back to site root after auth
      return baseUrl;
    },
  },
};

export default NextAuth(authOptions);
