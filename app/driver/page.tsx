// app/driver/page.tsx
import { PostRideForm } from "@/components/PostRideForm";

export default function DriverPortalPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">
        Driver portal
      </h1>
      <p className="text-sm text-slate-600">
        Here drivers will manage their rides, bookings, and earnings.
        For now, you can use the form below to post sample rides while
        we&apos;re still in development mode.
      </p>

      <PostRideForm />
    </div>
  );
}
