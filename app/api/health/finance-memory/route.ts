import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === "42P01" || maybe.message?.includes("schema cache") || maybe.message?.includes("Could not find the table") || false;
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const { error } = await supabase
    .from("financial_advisor_memory")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (!error) {
    return NextResponse.json({
      ok: true,
      available: true,
      table: "public.financial_advisor_memory",
    });
  }

  if (isMissingTableError(error)) {
    return NextResponse.json({
      ok: true,
      available: false,
      table: "public.financial_advisor_memory",
      reason: "missing_table_or_stale_schema_cache",
      action: "Run migrations and refresh Supabase schema cache.",
      requiredMigrations: [
        "20260402090000_financial_statement_ingestions.sql",
        "20260402101500_financial_advisor_memory.sql",
      ],
    });
  }

  return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
}
