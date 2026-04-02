import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function normalizeMonth(value: string | null): string {
  if (!value) return `${new Date().toISOString().slice(0, 7)}-01`;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return `${new Date().toISOString().slice(0, 7)}-01`;
  return `${parsed.toISOString().slice(0, 7)}-01`;
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_statement_ingestions")
    .select("id, account_name, institution, statement_month, file_name, bytes, ingestion_status, ingestion_notes, uploaded_at")
    .eq("user_id", user.id)
    .order("uploaded_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ statements: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const form = await request.formData();
  const accountName = String(form.get("accountName") ?? "Unknown account").slice(0, 120);
  const institution = form.get("institution") ? String(form.get("institution")).slice(0, 120) : null;
  const statementMonth = normalizeMonth(form.get("statementMonth") ? String(form.get("statementMonth")) : null);
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const fileName = file.name || `statement-${Date.now()}`;
  const text = await file.text();
  const extractedText = text.slice(0, 20_000);

  const supabase = await createClient();
  const now = new Date().toISOString();
  const payload = {
    user_id: user.id,
    account_name: accountName,
    institution: institution,
    statement_month: statementMonth,
    file_name: fileName,
    content_type: file.type || null,
    bytes: file.size,
    ingestion_status: "processed",
    ingestion_notes: "Uploaded from finance tab and text extracted for advisor context.",
    extracted_text: extractedText,
    uploaded_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase.from("financial_statement_ingestions").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ statement: data }, { status: 201 });
}
