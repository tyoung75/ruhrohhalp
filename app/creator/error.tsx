"use client";

export default function CreatorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "monospace" }}>
      <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 12 }}>
        Creator page error: {error.message}
      </div>
      <div style={{ color: "#888", fontSize: 10, marginBottom: 20, whiteSpace: "pre-wrap", maxWidth: 600, margin: "0 auto 20px" }}>
        {error.stack}
      </div>
      <button
        onClick={reset}
        style={{
          background: "#e8a838", color: "#1a1a1a", border: "none", borderRadius: 6,
          padding: "8px 16px", fontFamily: "monospace", fontSize: 12, cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
