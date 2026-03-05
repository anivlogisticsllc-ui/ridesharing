// pages/api/register.ts
import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { UserRole } from "@prisma/client";
import { sendVerificationEmail } from "../../lib/email";

type RegisterBody = {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  plan?: string; // e.g. "rider", "driver", "driver_monthly_driver", etc.
};

function resolveRoleFromPlan(planRaw: unknown): UserRole {
  const p = typeof planRaw === "string" ? planRaw.trim().toLowerCase() : "rider";

  // If it says driver (and not admin), treat as DRIVER
  if (p.includes("driver")) return UserRole.DRIVER;

  // Otherwise default to RIDER
  return UserRole.RIDER;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { name, email, phone, password, plan }: RegisterBody = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const emailTrimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(emailTrimmed)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = await prisma.user.findUnique({ where: { email: emailTrimmed } });
  if (existing) return res.status(400).json({ error: "Email is already registered" });

  const hash = await bcrypt.hash(password, 10);

  const role = resolveRoleFromPlan(plan);

  // Create user with emailVerified = false
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: emailTrimmed,
      phone: phone?.trim() || null,
      passwordHash: hash,
      role,
      emailVerified: false,
      onboardingCompleted: false,
    },
    select: { id: true, email: true },
  });

  const token = crypto.randomBytes(32).toString("hex");

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;

  await sendVerificationEmail(user.email, verifyUrl);

  return res.status(201).json({ ok: true });
}