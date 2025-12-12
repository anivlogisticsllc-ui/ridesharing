// pages/auth/verify.tsx
import { GetServerSideProps } from "next";
import { prisma } from "../../lib/prisma";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const token = ctx.query.token as string | undefined;

  if (!token) {
    return {
      redirect: {
        destination: "/auth/check-email?error=missing_token",
        permanent: false,
      },
    };
  }

  const record = await prisma.emailVerificationToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!record || record.expiresAt < new Date()) {
    return {
      redirect: {
        destination: "/auth/check-email?error=invalid_or_expired",
        permanent: false,
      },
    };
  }

  // Mark user as verified
  await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: true },
  });

  // Delete token so it can't be reused
  await prisma.emailVerificationToken.delete({
    where: { id: record.id },
  });

  // Redirect to membership signup page
  return {
    redirect: {
      destination: "/account/setup",
      permanent: false,
    },
  };
};

export default function VerifyPage() {
  // User will never see this, it's SSR-redirected
  return null;
}
