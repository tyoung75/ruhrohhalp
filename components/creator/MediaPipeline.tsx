"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface Suggestion {
  platform: string;
  body: string;
  content_type: string;
  why: string;
}

export function MediaPipeline() {
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setSuggestions([]);

    // Create preview
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setAnalyzing(true);

      try {
        const res = await api<{ ok: boolean; suggestions: Suggestion[] }>("/api/creator/media-analyze", {
          method: "POST",
          body: JSON.stringify({ media_url: dataUrl, auto_draft: false }),
        });
        setSuggestions(res.suggestions ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addToDrafts(suggestion: Suggestion, idx: number) {
    setDrafting((prev) => new Set(prev).add(idx));
    try {
      await api("/api/creator/media-analyze", {
        method: "POST",
        body: JSON.stringify({ media_url: preview, auto_draft: true }),
      });
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
    } finally {
      setDrafting((prev) => { const n = new Set(prev); n.delete(idx); return n; });
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>Media Pipeline — Upload + AI Analysis</div>
        <button
          onClick={async () => {
            setSyncing(true);
            try { await api("/api/creator/media-sync", { method: "POST" }); } finally { setSyncing(false); }
          }}
          disabled={syncing}
          style={{ background: C.card, color: syncing ? C.textDim : C.gem, border: `1px solid ${syncing ? C.border : C.gem}`, borderRadius: 6, padding: "4px 12px", fontFamily: C.mono, fontSize: 10, cursor: syncing ? "default" : "pointer" }}
        >
          {syncing ? "Syncing..." : "Sync Google Drive"}
        </button>
      </div>

      {/* Upload area */}
      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => void handleFile(e)} style={{ display: "none" }} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={analyzing}
        style={{
          width: "100%",
          padding: preview ? "12px" : "40px 20px",
          background: C.card,
          border: `2px dashed ${C.border}`,
          borderRadius: 12,
          color: C.textDim,
          cursor: "pointer",
          fontFamily: C.sans,
          fontSize: 13,
          textAlign: "center",
          marginBottom: 16,
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.cl; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
      >
        {analyzing ? "Analyzing with Gemini Vision..." : preview ? `Change image (${fileName})` : "Drop an image here or click to upload"}
      </button>

      {/* Preview + Suggestions side by side */}
      {preview && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Image preview */}
          <div style={{ flex: "0 0 200px" }}>
            <img src={preview} alt="Upload preview" style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}` }} />
          </div>

          {/* Suggestions */}
          <div style={{ flex: 1, minWidth: 250 }}>
            {analyzing && (
              <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 12, padding: 20, textAlign: "center" }}>
                Analyzing image with Gemini Vision...
              </div>
            )}
            {!analyzing && suggestions.length === 0 && (
              <div style={{ color: C.textDim, fontSize: 12 }}>No suggestions generated. Try a different image.</div>
            )}
            {suggestions.map((s, i) => (
              <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, background: `${C.cl}15`, padding: "2px 6px", borderRadius: 4 }}>{s.platform}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, background: C.card, padding: "2px 6px", borderRadius: 4 }}>{s.content_type}</span>
                  </div>
                  <button
                    onClick={() => void addToDrafts(s, i)}
                    disabled={drafting.has(i)}
                    style={{ background: `${C.gpt}15`, color: C.gpt, border: `1px solid ${C.gpt}30`, borderRadius: 6, padding: "3px 10px", fontFamily: C.mono, fontSize: 10, cursor: "pointer" }}
                  >
                    {drafting.has(i) ? "..." : "+ Draft"}
                  </button>
                </div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>{s.body}</div>
                <div style={{ fontSize: 10, color: C.textFaint, fontStyle: "italic" }}>{s.why}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!preview && (
        <div style={{ textAlign: "center", color: C.textFaint, fontSize: 12, padding: "20px 0" }}>
          Upload a photo from your training, runs, travel, or daily life.<br />
          Gemini Vision will analyze it and suggest posts in your voice.
        </div>
      )}
    </div>
  );
}
