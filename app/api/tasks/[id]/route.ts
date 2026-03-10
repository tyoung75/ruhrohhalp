import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { taskPatchSchema } from "@/lib/validation";
import { getTierForUser } from "@/lib/profile";
import { isModelAllowedForTier } from "@/lib/tiers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await context.params;

  const updates: Record<string, string | null> = {};
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.title) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  if (parsed.data.selectedModel !== undefined) {
    const tier = await getTierForUser(user.id);
    if (parsed.data.selectedModel && !isModelAllowedForTier(tier, parsed.data.selectedModel)) {
      return NextResponse.json({ error: "Selected model not available for your plan." }, { status: 403 });
    }
    updates.selected_model = parsed.data.selectedModel;
  }

  updates.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
