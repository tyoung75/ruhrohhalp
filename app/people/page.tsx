"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface Person {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string;
  relationship: string;
  notes: string;
  last_contact_at: string | null;
  tags: string[];
  created_at: string;
}

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);

  async function load() {
    const res = await api<{ rows: Person[] }>(`/api/knowledge?table=people&limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`);
    setPeople(res.rows ?? []);
  }

  useEffect(() => { void load(); }, [search]);

  const now = Date.now();
  const coldThreshold = 30 * 86400000;

  return (
    <main style={{ background: C.bg, minHeight: "100%", color: C.text, padding: 20 }}>
      <h1 style={{ fontFamily: C.serif, color: C.cream, margin: "0 0 16px", fontSize: 22 }}>People</h1>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search contacts..."
        style={{ width: "100%", maxWidth: 400, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, color: C.text, outline: "none", marginBottom: 16, boxSizing: "border-box" }}
      />

      <div style={{ display: "grid", gap: 8 }}>
        {people.length === 0 && <div style={{ color: C.textDim, fontSize: 13 }}>No contacts found. Add people via the Chief of Staff.</div>}
        {people.map((person) => {
          const cold = person.last_contact_at && (now - new Date(person.last_contact_at).getTime()) > coldThreshold;
          return (
            <button
              key={person.id}
              onClick={() => setSelected(person)}
              style={{ textAlign: "left", background: C.surface, border: `1px solid ${cold ? "#F59E0B30" : C.border}`, borderRadius: 10, padding: 14, color: C.text, cursor: "pointer", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{person.name}</div>
                <div style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>
                  {person.company && <span>{person.company} &middot; </span>}
                  <span>{person.relationship}</span>
                  {person.email && <span style={{ marginLeft: 8, color: C.textFaint }}>{person.email}</span>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {cold && <div style={{ color: "#F59E0B", fontFamily: C.mono, fontSize: 10 }}>30+ days</div>}
                {person.last_contact_at && <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10 }}>{new Date(person.last_contact_at).toLocaleDateString()}</div>}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <aside style={{ position: "fixed", top: 0, right: 0, width: 420, maxWidth: "100vw", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 20, overflowY: "auto", zIndex: 100, boxShadow: "-4px 0 20px #0004" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontFamily: C.serif, color: C.cream, margin: 0 }}>{selected.name}</h2>
            <button onClick={() => setSelected(null)} style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>&#10005;</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: `${C.cl}15`, color: C.cl }}>{selected.relationship}</span>
            {selected.company && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: C.border, color: C.textDim }}>{selected.company}</span>}
          </div>
          {selected.email && <div style={{ color: C.textDim, fontSize: 12, marginBottom: 6 }}>Email: {selected.email}</div>}
          {selected.notes && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>{selected.notes}</div>}
          {selected.tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {selected.tags.map((t) => <span key={t} style={{ fontSize: 10, fontFamily: C.mono, padding: "2px 6px", borderRadius: 4, background: C.card, color: C.textFaint }}>{t}</span>)}
            </div>
          )}
          {selected.last_contact_at && <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 11 }}>Last contact: {new Date(selected.last_contact_at).toLocaleDateString()}</div>}
        </aside>
      )}
    </main>
  );
}
