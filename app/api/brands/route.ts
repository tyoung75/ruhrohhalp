import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BrandDeal } from "@/lib/types/brands";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const statusFilter = request.nextUrl.searchParams.get("status");
  let query = supabase.from("brand_deals").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (statusFilter) {
    query = query.in("status", statusFilter.split(",").map((s) => s.trim()));
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deals: (data ?? []) as BrandDeal[] });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("brand_deals")
    .insert({ ...body, user_id: user.id, created_at: now, updated_at: now })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data as BrandDeal }, { status: 201 });
}
