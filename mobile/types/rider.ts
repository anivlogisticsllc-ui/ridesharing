// mobile/types/rider.ts

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "ACCEPTED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type PaymentType = "CARD" | "CASH";

export type TipStatus =
  | "NOT_OFFERED"
  | "ELIGIBLE"
  | "PENDING"
  | "SUCCEEDED"
  | "SKIPPED"
  | "FAILED";

export type RiderBooking = {
  id: string;
  bookingId: string | null;
  status: BookingStatus | string;
  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string;
  rideStatus: string;
  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;
  isRideOnly?: boolean;

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;
  totalPriceCents?: number | null;

  originalPaymentType?: PaymentType | null;
  originalCashDiscountBps?: number | null;
  cashNotPaidAt?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;
  fallbackCardChargedAt?: string | null;

  refundIssued?: boolean | null;
  refundAmountCents?: number | null;
  refundIssuedAt?: string | null;
  disputeResolvedAt?: string | null;

  tipStatus?: TipStatus | string | null;
  tipAmountCents?: number | null;
  tipPercent?: number | null;
  tipEligibleUntil?: string | null;
  tipSelectedAt?: string | null;
  tipChargedAt?: string | null;
  tipSkippedAt?: string | null;
};

export type RiderBookingsResponse =
  | {
      ok: true;
      bookings: RiderBooking[];
    }
  | {
      ok: false;
      error: string;
    };