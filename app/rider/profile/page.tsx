export default function RiderProfilePage() {
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: 26,
          fontWeight: 650,
          marginBottom: 8,
        }}
      >
        Rider profile
      </h1>
      <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
        This is a placeholder profile page. Later you can add contact
        info, documents, and preferences here.
      </p>

      {/* TODO: real profile fields */}
      <div
        style={{
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          padding: 16,
          background: "#f9fafb",
          fontSize: 14,
        }}
      >
        <p style={{ margin: 0 }}>
          Profile details will go here (name, email, phone, ID docs, etc.).
        </p>
      </div>
    </main>
  );
}
