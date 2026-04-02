import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { archiveDeal } from "@/lib/brands/pipeline";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const supabase = await createClient();

  const [dealRes, emailsRes] = await Promise.all([
    supabase.from("brand_deals").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("brand_outreach_emails").select("*").eq("brand_deal_id", id).order("sent_at", { ascending: false }),
  ]);

  if (dealRes.error) return NextResponse.json({ error: dealRes.error.message }, { status: 500 });
  if (!dealRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (emailsRes.error) return NextResponse.json({ error: emailsRes.error.message }, { status: 500 });

  return NextResponse.json({ deal: dealRes.data, emails: emailsRes.data ?? [] });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("brand_deals")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  await archiveDeal(id, body.reason ?? "Archived by user");

  return NextResponse.json({ ok: true, user_id: user.id });
}
