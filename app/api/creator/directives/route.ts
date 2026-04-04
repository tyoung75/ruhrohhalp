import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

/**
 * GET /api/creator/directives
 *
 * Returns active content strategy directives.
 * Called by the content generation agents and briefing generator
 * to respect the user's standing instructions about content direction.
 *
 * Query params:
 * - active: "true" (default) | "false" | "all"
 * - platform: filter to directives for a specific platform
 *
 * Supports both user auth and webhook secret auth.
 */
export async function GET(request: NextRequest) {
  const webhookSecret = request.headers.get("x-webhook-secret");
  let userId: string | null = null;

  if (webhookSecret) {
    const webhookError = validateWebhookSecret(webhookSecret);
    if (webhookError) return webhookError;
    const url = new URL(request.url);
    userId = url.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id required for webhook calls" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (response || !user) return response;
    userId = user.id;
  }

  const url = new URL(request.url);
  const activeParam = url.searchParams.get("active") ?? "true";
  const platform = url.searchParams.get("platform");

  const supabase = await createClient();

  let query = supabase
    .from("content_directives")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (activeParam === "true") {
    query = query.eq("active", true);
    // Also filter out expired directives
    query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  } else if (activeParam === "false") {
    query = query.eq("active", false);
  }

  if (platform) {
    // Match directives that apply to all platforms (null) or include this platform
    query = query.or(`platforms.is.null,platforms.cs.{${platform}}`);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ directives: data ?? [] });
}

/**
 * POST /api/creator/directives
 *
 * Creates a new content strategy directive. These are broad standing
 * instructions that shape how the content generation agents produce
 * content — e.g., "shift away from gym selfies", "more race prep content",
 * "stop using the word grind in captions".
 *
 * Body:
 * {
 *   directive: string (required)
 *   platforms?: string[] (optional, null = all platforms)
 *   expires_at?: string (optional ISO date, null = no expiry)
 * }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { directive, platforms, expires_at } = body;

  if (!directive || typeof directive !== "string" || !directive.trim()) {
    return NextResponse.json({ error: "directive is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_directives")
    .insert({
      user_id: user.id,
      directive: directive.trim(),
      platforms: platforms ?? null,
      expires_at: expires_at ?? null,
      active: true,
      applied: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Embed directive into shared brain — highest importance since directives are standing rules
  try {
    await embedAndStore(
      `[CONTENT DIRECTIVE] ${directive.trim()}${platforms ? ` (platforms: ${platforms.join(", ")})` : ""}`,
      {
        userId: user.id,
        source: "manual",
        sourceId: `directive:${data.id}`,
        category: "general",
        importance: 9,
        tags: ["feedback:directive", "domain:content", "system:feedback"],
      },
    );
  } catch (e) { logError("directive.embed", e); }

  return NextResponse.json({ directive: data }, { status: 201 });
}

/**
 * PATCH /api/creator/directives
 *
 * Updates directives — deactivate, mark applied, or update text.
 *
 * Body:
 * {
 *   id: string (required)
 *   active?: boolean
 *   applied?: boolean
 *   directive?: string (update text)
 * }
 */
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Only allow safe fields
  const allowedFields: Record<string, unknown> = {};
  if (typeof updates.active === "boolean") allowedFields.active = updates.active;
  if (typeof updates.applied === "boolean") allowedFields.applied = updates.applied;
  if (typeof updates.directive === "string") allowedFields.directive = updates.directive.trim();

  if (Object.keys(allowedFields).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("content_directives")
    .update(allowedFields)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/creator/directives
 *
 * Deactivates a directive (soft delete).
 *
 * Body:
 * { id: string }
 */
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("content_directives")
    .update({ active: false })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
