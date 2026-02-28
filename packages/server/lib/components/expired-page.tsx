export default function ExpiredPage() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e5e5e5",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          textAlign: "center",
          maxWidth: "400px",
          padding: "32px",
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "12px" }}>Link expired</h1>
        <p style={{ color: "#a3a3a3", fontSize: "15px", lineHeight: 1.6 }}>
          This invite link has expired or is invalid.
          <br />
          Generate a new one from the CLI:
        </p>
        <code
          style={{
            display: "inline-block",
            marginTop: "16px",
            padding: "8px 16px",
            borderRadius: "6px",
            backgroundColor: "#171717",
            border: "1px solid #262626",
            color: "#e5e5e5",
            fontSize: "14px",
          }}
        >
          clawrun web &lt;instance&gt;
        </code>
      </div>
    </div>
  );
}
