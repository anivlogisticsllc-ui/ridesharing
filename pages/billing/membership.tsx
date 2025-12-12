// pages/billing/membership.tsx

export default function MembershipPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 4,
          padding: 24,
          maxWidth: 480,
          width: "100%",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Membership setup
        </h1>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          Your email has been verified. Next step is to choose your membership
          and set up a recurring monthly payment.
        </p>

        <p style={{ fontSize: 14, marginBottom: 8 }}>
          <strong>Coming next:</strong> we’ll integrate Stripe (or another
          provider) here to:
        </p>
        <ul style={{ fontSize: 14, paddingLeft: 20 }}>
          <li>Collect credit card details securely</li>
          <li>Create a recurring monthly subscription</li>
          <li>Store membership status in the database</li>
        </ul>
      </div>
    </main>
  );
}
