"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface RevenueData {
  brand_revenue: number;
  app_revenue: number;
  affiliate_revenue: number;
  total_monthly: number;
  target: number;
  progress_pct: number;
  brands_closed: number;
  brands_active: number;
  pipeline_value_low: number;
  pipeline_value_high: number;
}

interface HabitData {
  id: string;
  name: string;
  icon: string;
  streak: number;
  completed_today: boolean;
  last_7_days: string[];
}

export function RevenueHabitsWidget() {
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [logging, setLogging] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<RevenueData>("/api/revenue").then(setRevenue).catch(() => {});
    api<{ habits: HabitData[] }>("/api/habits").then((r) => setHabits(r.habits ?? [])).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });

  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 0", flexWrap: "wrap" }}>
      {/* Revenue Progress */}
      {revenue && (
        <div style={{ flex: "1 1 200px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Monthly Revenue</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.cream }}>${revenue.total_monthly.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: C.textDim }}>/ ${revenue.target.toLocaleString()}</span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${Math.min(revenue.progress_pct, 100)}%`, background: revenue.progress_pct >= 100 ? C.gpt : C.cl, borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 10, color: C.textDim }}>
            {revenue.brand_revenue > 0 && <span>Brands: ${revenue.brand_revenue.toLocaleString()}</span>}
            {revenue.app_revenue > 0 && <span>App: ${revenue.app_revenue.toLocaleString()}</span>}
            {revenue.affiliate_revenue > 0 && <span>Affiliate: ${revenue.affiliate_revenue.toLocaleString()}</span>}
            {revenue.brands_active > 0 && <span style={{ color: C.textFaint }}>Pipeline: ${revenue.pipeline_value_low.toLocaleString()}-${revenue.pipeline_value_high.toLocaleString()}</span>}
          </div>
        </div>
      )}

      {/* Habit Streaks */}
      {habits.length > 0 && (
        <div style={{ flex: "1 1 280px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Habits</div>
          <div style={{ display: "grid", gap: 4 }}>
            {habits.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={async () => {
                    if (h.completed_today || logging.has(h.id)) return;
                    setLogging((prev) => new Set(prev).add(h.id));
                    try {
                      await api("/api/habits", { method: "POST", body: JSON.stringify({ action: "log", habit_id: h.id }) });
                      setHabits((prev) => prev.map((hb) => hb.id === h.id ? { ...hb, completed_today: true, streak: hb.streak + 1, last_7_days: [today, ...hb.last_7_days] } : hb));
                    } finally {
                      setLogging((prev) => { const n = new Set(prev); n.delete(h.id); return n; });
                    }
                  }}
                  disabled={h.completed_today || logging.has(h.id)}
                  style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${h.completed_today ? C.gpt : C.border}`, background: h.completed_today ? `${C.gpt}20` : "transparent", cursor: h.completed_today ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: h.completed_today ? C.gpt : C.textFaint, flexShrink: 0, padding: 0 }}
                >
                  {h.completed_today ? "\u2713" : h.icon || "+"}
                </button>
                <span style={{ fontSize: 11, color: C.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                {/* 7-day dots */}
                <div style={{ display: "flex", gap: 2 }}>
                  {last7.map((date) => (
                    <div key={date} style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: h.last_7_days.includes(date) ? (date === today ? C.gpt : `${C.gpt}80`) : C.border,
                    }} />
                  ))}
                </div>
                {h.streak > 0 && (
                  <span style={{ fontFamily: C.mono, fontSize: 9, color: h.streak >= 7 ? C.gold : C.textDim, minWidth: 24, textAlign: "right" }}>{h.streak}d</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
