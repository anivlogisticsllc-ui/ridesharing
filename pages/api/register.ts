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
  plan?: string; // e.g. "rider", "driver", "both", "driver_monthly_driver", etc.
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { name, email, phone, password, plan }: RegisterBody = req.body || {};

  // Basic validation
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const emailTrimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(emailTrimmed)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email: emailTrimmed },
  });

  if (existing) {
    return res.status(400).json({ error: "Email is already registered" });
  }

  const hash = await bcrypt.hash(password, 10);

  // Decide role from plan (defensive)
  const planNormalized = (plan || "rider").toLowerCase();

  console.log("[REGISTER] incoming plan:", plan, "normalized:", planNormalized);

  let role: UserRole = UserRole.RIDER; // safe default

  if (planNormalized.includes("both")) {
    role = UserRole.BOTH;
  } else if (
    planNormalized.includes("driver") &&
    !planNormalized.includes("rider")
  ) {
    // Only treat as driver if it doesn't also mention rider
    role = UserRole.DRIVER;
  } else {
    role = UserRole.RIDER;
  }

  console.log("[REGISTER] resolved role:", role);

  // Create user with emailVerified = false
  const user = await prisma.user.create({
    data: {
      name,
      email: emailTrimmed,
      phone: phone?.trim() || null,
      passwordHash: hash,
      role,
      emailVerified: false,
      onboardingCompleted: false,
    },
  });

  // Create email verification token (valid for 24 hours)
  const token = crypto.randomBytes(32).toString("hex");

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24h
    },
  });

  // Build verification URL
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;

  await sendVerificationEmail(user.email, verifyUrl);

  return res.status(201).json({ ok: true });
}
