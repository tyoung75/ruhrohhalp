"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

type KnowledgeTable =
  | "memories"
  | "decisions"
  | "projects"
  | "people"
  | "ideas"
  | "meetings"
  | "documents";

const TABS: { id: KnowledgeTable; label: string; icon: string; color: string }[] = [
  { id: "memories", label: "Memories", icon: "◈", color: C.cl },
  { id: "decisions", label: "Decisions", icon: "◇", color: C.gold },
  { id: "projects", label: "Projects", icon: "▣", color: C.gem },
  { id: "people", label: "People", icon: "◉", color: C.gpt },
  { id: "ideas", label: "Ideas", icon: "✦", color: "#a78bfa" },
  { id: "meetings", label: "Meetings", icon: "◷", color: C.note },
  { id: "documents", label: "Docs", icon: "▤", color: C.textDim },
];

// Display config per table: which fields to show as columns
const TABLE_DISPLAY: Record<KnowledgeTable, { primary: string; secondary: string; meta: string[] }> = {
  memories: { primary: "summary", secondary: "content", meta: ["category", "source", "importance"] },
  decisions: { primary: "title", secondary: "description", meta: ["status", "category"] },
  projects: { primary: "name", secondary: "description", meta: ["status", "priority"] },
  people: { primary: "name", secondary: "notes", meta: ["relationship", "company", "role"] },
  ideas: { primary: "title", secondary: "description", meta: ["status", "category"] },
  meetings: { primary: "title", secondary: "summary", meta: ["meeting_at", "duration_minutes"] },
  documents: { primary: "title", secondary: "content", meta: ["doc_type", "status"] },
};

interface KnowledgeResponse {
  rows: Record<string, unknown>[];
  total: number;
  table: string;
  limit: number;
  offset: number;
}

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<KnowledgeTable>("memories");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounce, setSearchDebounce] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const limit = 30;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        table: activeTab,
        limit: String(limit),
        offset: String(offset),
      });
      if (searchDebounce) params.set("search", searchDebounce);
      const data = await api<KnowledgeResponse>(`/api/knowledge?${params}`);
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      console.error("Failed to fetch knowledge:", e);
    } finally {
      setLoading(false);
    }
  }, [activeTab, offset, searchDebounce]);

  useEffect(() => {
    setOffset(0);
    setExpandedRow(null);
    setEditingRow(null);
  }, [activeTab, searchDebounce]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const display = TABLE_DISPLAY[activeTab];

  async function handleSave(id: string) {
    try {
      await api("/api/knowledge", {
        method: "PATCH",
        body: JSON.stringify({ table: activeTab, id, data: editData }),
      });
      setEditingRow(null);
      setEditData({});
      fetchRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this row? This cannot be undone.")) return;
    try {
      await api("/api/knowledge", {
        method: "DELETE",
        body: JSON.stringify({ table: activeTab, id }),
      });
      fetchRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function startEdit(row: Record<string, unknown>) {
    setEditingRow(row.id as string);
    setEditData({ ...row });
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: C.serif, fontSize: 22, fontStyle: "italic", color: C.cream }}>
          Knowledge Browser
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 2 }}>
          Browse and edit all stored knowledge across 7 tables
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: "10px 22px",
          borderBottom: `1px solid ${C.border}`,
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              borderRadius: 6,
              border: `1px solid ${activeTab === tab.id ? `${tab.color}40` : C.border}`,
              background: activeTab === tab.id ? `${tab.color}14` : "transparent",
              color: activeTab === tab.id ? tab.color : C.textDim,
              fontFamily: C.mono,
              fontSize: 10,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search + stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 22px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            background: C.card,
            border: `1px solid ${C.borderMid}`,
            borderRadius: 7,
            padding: "0 10px",
          }}
        >
          <span style={{ color: C.textFaint, fontSize: 12 }}>⌕</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.text,
              fontFamily: C.sans,
              fontSize: 12,
              padding: "8px 0",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 11 }}
            >
              ✕
            </button>
          )}
        </div>
        <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, flexShrink: 0 }}>
          {total} rows
        </span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 16px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Spinner color={C.cl} size={16} />
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "50px 20px",
              color: C.textFaint,
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 14,
            }}
          >
            {search ? `No ${activeTab} match "${search}"` : `No ${activeTab} stored yet`}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 10 }}>
            {rows.map((row, i) => {
              const id = row.id as string;
              const isExpanded = expandedRow === id;
              const isEditing = editingRow === id;
              const primaryVal = (row[display.primary] as string) || "(empty)";
              const secondaryVal = (row[display.secondary] as string) || "";
              const tags = (row.tags as string[]) || [];

              return (
                <div
                  key={id}
                  className="fadeUp"
                  style={{
                    animationDelay: `${i * 0.02}s`,
                    background: C.card,
                    border: `1px solid ${isExpanded ? C.borderMid : C.border}`,
                    borderRadius: 9,
                    overflow: "hidden",
                  }}
                >
                  {/* Row header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                    onClick={() => setExpandedRow(isExpanded ? null : id)}
                  >
                    <span style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono, flexShrink: 0 }}>
                      {isExpanded ? "▾" : "▸"}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <input
                          value={(editData[display.primary] as string) || ""}
                          onChange={(e) => setEditData({ ...editData, [display.primary]: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: "100%",
                            background: C.surface,
                            border: `1px solid ${C.borderMid}`,
                            borderRadius: 5,
                            padding: "4px 8px",
                            color: C.cream,
                            fontFamily: C.sans,
                            fontSize: 12,
                            outline: "none",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            fontFamily: C.sans,
                            fontSize: 12,
                            color: C.cream,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {primaryVal.slice(0, 120)}
                        </div>
                      )}
                    </div>

                    {/* Meta badges */}
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {display.meta.slice(0, 2).map((key) => {
                        const val = row[key];
                        if (!val) return null;
                        return (
                          <span
                            key={key}
                            style={{
                              fontFamily: C.mono,
                              fontSize: 9,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: C.surface,
                              border: `1px solid ${C.border}`,
                              color: C.textDim,
                            }}
                          >
                            {String(val).slice(0, 20)}
                          </span>
                        );
                      })}
                    </div>

                    {/* Date */}
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, flexShrink: 0 }}>
                      {(row.created_at as string)?.slice(0, 10)}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div
                      className="fadeUp"
                      style={{
                        padding: "0 14px 12px",
                        borderTop: `1px solid ${C.border}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        marginTop: 0,
                        paddingTop: 10,
                      }}
                    >
                      {/* Secondary content */}
                      {isEditing ? (
                        <textarea
                          value={(editData[display.secondary] as string) || ""}
                          onChange={(e) =>
                            setEditData({ ...editData, [display.secondary]: e.target.value })
                          }
                          rows={5}
                          style={{
                            width: "100%",
                            background: C.surface,
                            border: `1px solid ${C.borderMid}`,
                            borderRadius: 5,
                            padding: "8px 10px",
                            color: C.text,
                            fontFamily: C.sans,
                            fontSize: 11,
                            lineHeight: 1.5,
                            resize: "vertical",
                            outline: "none",
                          }}
                        />
                      ) : (
                        secondaryVal && (
                          <div
                            style={{
                              fontFamily: C.sans,
                              fontSize: 11,
                              color: C.textDim,
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              maxHeight: 200,
                              overflowY: "auto",
                            }}
                          >
                            {secondaryVal}
                          </div>
                        )
                      )}

                      {/* All meta fields */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {display.meta.map((key) => {
                          const val = row[key];
                          if (val === null || val === undefined || val === "") return null;
                          return (
                            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, letterSpacing: 0.3 }}>
                                {key.replace(/_/g, " ")}
                              </span>
                              <span style={{ fontFamily: C.sans, fontSize: 11, color: C.text }}>
                                {String(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tags */}
                      {tags.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontFamily: C.mono,
                                fontSize: 9,
                                padding: "1px 6px",
                                borderRadius: 3,
                                background: `${C.cl}14`,
                                border: `1px solid ${C.cl}28`,
                                color: C.cl,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 6, paddingTop: 4 }}>
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => void handleSave(id)}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 6,
                                border: "none",
                                background: C.cl,
                                color: C.bg,
                                fontFamily: C.mono,
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingRow(null);
                                setEditData({});
                              }}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                background: "none",
                                color: C.textDim,
                                fontFamily: C.mono,
                                fontSize: 10,
                                cursor: "pointer",
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(row)}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                background: "none",
                                color: C.textDim,
                                fontFamily: C.mono,
                                fontSize: 10,
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDelete(id)}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 6,
                                border: `1px solid ${C.reminder}30`,
                                background: "none",
                                color: C.reminder,
                                fontFamily: C.mono,
                                fontSize: 10,
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
            padding: "10px 22px",
            borderTop: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: `1px solid ${C.border}`,
              background: "none",
              color: offset === 0 ? C.textFaint : C.textDim,
              fontFamily: C.mono,
              fontSize: 10,
              cursor: offset === 0 ? "default" : "pointer",
            }}
          >
            ← Prev
          </button>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: `1px solid ${C.border}`,
              background: "none",
              color: offset + limit >= total ? C.textFaint : C.textDim,
              fontFamily: C.mono,
              fontSize: 10,
              cursor: offset + limit >= total ? "default" : "pointer",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
