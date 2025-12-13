// pages/api/auth/reset-password.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";
import bcrypt from "bcrypt";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, password } = req.body as {
    token?: string;
    password?: string;
  };

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Invalid token" });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  // Look up token row
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  // ❗ Use `expiresAt` here, not `expires`
  if (!record || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "Token expired or invalid." });
  }

  const hashed = await bcrypt.hash(password, 10);

  // Update password AND verify email
  await prisma.user.update({
    where: { id: record.userId },
    data: {
      passwordHash: hashed,
      // If your schema uses Boolean for emailVerified:
      emailVerified: true,
      // If instead your schema uses DateTime? for emailVerified,
      // comment the line above and use this:
      // emailVerified: new Date(),
    },
  });

  // Clean up used token
  await prisma.passwordResetToken.delete({
    where: { token },
  });

  return res.json({ ok: true });
}
