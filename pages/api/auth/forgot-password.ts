// pages/api/auth/forgot-password.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";
import { sendPasswordResetEmail } from "../../../lib/email";
import crypto from "crypto";

const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // If user DOES NOT exist → tell the UI
  if (!user) {
    return res.json({ ok: true, userExists: false });
  }

  // Clean previous tokens
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id },
  });

  // Create new token
  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  return res.json({ ok: true, userExists: true });
}
