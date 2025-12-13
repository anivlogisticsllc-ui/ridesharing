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
    return res.status(400).json({ error: "Missing token" });
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters long" });
  }

  try {
    const reset = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!reset || reset.expires < new Date()) {
      return res.status(400).json({ error: "Reset link is invalid or expired" });
    }

    const hash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: hash,
          // optional: ensure email is marked verified after reset
          emailVerified: reset.user.emailVerified ?? true,
        },
      }),
      prisma.passwordResetToken.delete({
        where: { token },
      }),
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[reset-password] error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
