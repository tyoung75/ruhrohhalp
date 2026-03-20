/**
 * /api/knowledge — Unified CRUD for all knowledge tables
 *
 * GET    ?table=memories&limit=50&offset=0&search=...&category=...
 * POST   { table, data }  — Insert a new row
 * PATCH  { table, id, data } — Update a row
 * DELETE { table, id } — Delete a row
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

const ALLOWED_TABLES = [
  "memories",
  "decisions",
  "projects",
  "people",
  "ideas",
  "meetings",
  "documents",
] as const;

type KnowledgeTable = (typeof ALLOWED_TABLES)[number];

function isValidTable(t: string): t is KnowledgeTable {
  return ALLOWED_TABLES.includes(t as KnowledgeTable);
}

// Columns to select per table (exclude embedding vector for performance)
const TABLE_COLUMNS: Record<KnowledgeTable, string> = {
  memories:
    "id, user_id, content, summary, category, source, source_id, tags, importance, last_accessed_at, created_at, updated_at",
  decisions:
    "id, user_id, title, description, context, reasoning, outcome, alternatives, status, category, decided_at, review_at, project_id, tags, created_at, updated_at",
  projects:
    "id, user_id, name, slug, description, status, priority, goals, due_date, completed_at, tags, created_at, updated_at",
  people:
    "id, user_id, name, email, phone, company, role, relationship, notes, commitments, last_contact_at, tags, created_at, updated_at",
  ideas:
    "id, user_id, title, description, source_type, status, category, project_id, tags, created_at, updated_at",
  meetings:
    "id, user_id, title, description, summary, notes, action_items, extracted_task_ids, attendee_ids, project_id, calendar_event_id, meeting_at, duration_minutes, location, tags, created_at, updated_at",
  documents:
    "id, user_id, title, content, doc_type, status, drive_file_id, chunk_index, parent_doc_id, project_id, tags, created_at, updated_at",
};

// ─── GET: List / search rows ─────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const table = url.searchParams.get("table") || "memories";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const search = url.searchParams.get("search") || "";
  const category = url.searchParams.get("category") || "";
  const status = url.searchParams.get("status") || "";

  if (!isValidTable(table)) {
    return NextResponse.json({ error: `Invalid table: ${table}` }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    let query = supabase
      .from(table)
      .select(TABLE_COLUMNS[table], { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Text search across common text columns
    if (search) {
      // Use ilike for basic text search
      if (table === "memories") {
        query = query.or(`content.ilike.%${search}%,summary.ilike.%${search}%`);
      } else if (table === "people") {
        query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,notes.ilike.%${search}%`);
      } else {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      }
    }

    // Category filter (tables that have it)
    if (category && ["memories", "decisions", "ideas"].includes(table)) {
      query = query.eq("category", category);
    }

    // Status filter (tables that have it)
    if (status && ["decisions", "projects", "ideas", "documents"].includes(table)) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      logError("knowledge.list", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rows: data || [], total: count || 0, table, limit, offset });
  } catch (error) {
    logError("knowledge.list", error);
    return NextResponse.json({ error: "Failed to fetch knowledge" }, { status: 500 });
  }
}

// ─── POST: Create a new row ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const body = await request.json();
    const { table, data } = body;

    if (!table || !isValidTable(table)) {
      return NextResponse.json({ error: `Invalid table: ${table}` }, { status: 400 });
    }

    if (!data || typeof data !== "object") {
      return NextResponse.json({ error: "data object required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from(table)
      .insert({ ...data, user_id: user.id })
      .select()
      .single();

    if (error) {
      logError("knowledge.create", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    logError("knowledge.create", error);
    return NextResponse.json({ error: "Failed to create row" }, { status: 500 });
  }
}

// ─── PATCH: Update a row ─────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const body = await request.json();
    const { table, id, data } = body;

    if (!table || !isValidTable(table)) {
      return NextResponse.json({ error: `Invalid table: ${table}` }, { status: 400 });
    }

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    // Remove protected fields
    const { user_id, embedding, created_at, ...safeData } = data || {};

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from(table)
      .update({ ...safeData, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      logError("knowledge.update", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(row);
  } catch (error) {
    logError("knowledge.update", error);
    return NextResponse.json({ error: "Failed to update row" }, { status: 500 });
  }
}

// ─── DELETE: Delete a row ────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const body = await request.json();
    const { table, id } = body;

    if (!table || !isValidTable(table)) {
      return NextResponse.json({ error: `Invalid table: ${table}` }, { status: 400 });
    }

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      logError("knowledge.delete", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("knowledge.delete", error);
    return NextResponse.json({ error: "Failed to delete row" }, { status: 500 });
  }
}
