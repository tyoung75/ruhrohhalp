import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadSystemContext,
  loadPerformanceContext,
  generatePlatformVariants,
  auditVariant,
  type ContentIdea,
} from "@/lib/ai/platform-intelligence";

/**
 * POST /api/content-queue/generate
 * Accepts a ContentIdea, loads system + performance context, runs Platform Intelligence Agent,
 * audits via Llama 4 Scout, saves variants to content_queue.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const idea: ContentIdea = {
    topic: body.topic,
    platforms: body.platforms ?? ["threads"],
    content_type: body.content_type,
    angle: body.angle,
    goal_id: body.goal_id,
  };

  if (!idea.topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  // Load context
  const [systemCtx, performanceCtx] = await Promise.all([
    loadSystemContext(user.id),
    loadPerformanceContext(user.id),
  ]);

  // Generate platform variants via Opus
  let variants;
  try {
    variants = await generatePlatformVariants(idea, systemCtx, performanceCtx);
  } catch (err) {
    return NextResponse.json(
      { error: `Generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Generate a shared content_idea_id
  const contentIdeaId = crypto.randomUUID();

  // Audit each variant and save to content_queue
  const supabase = createAdminClient();
  const saved = [];

  for (const variant of variants) {
    // Audit via Groq/Llama 4 Scout
    const audit = await auditVariant(variant);

    const { data, error } = await supabase
      .from("content_queue")
      .insert({
        user_id: user.id,
        platform: variant.platform,
        content_type: variant.content_type ?? "text",
        body: variant.body,
        caption: variant.caption,
        title: variant.title,
        hashtags: variant.hashtags ?? [],
        topic: idea.topic,
        platform_format: variant.platform_format,
        platform_spec: variant.platform_spec ?? {},
        content_idea_id: contentIdeaId,
        status: "draft",
        context_snapshot: { system: systemCtx, performance_summary: Object.keys(performanceCtx.content_patterns) },
        agent_reasoning: `Platform Intelligence Agent generated for topic: ${idea.topic}`,
        confidence_score: audit.passed ? 0.8 : 0.5,
        ai_audit_passed: audit.passed,
        audit_notes: audit.notes,
        generated_by: "platform_intelligence_agent",
      })
      .select("id, platform, content_type, status, ai_audit_passed")
      .single();

    if (!error && data) {
      saved.push(data);
    }
  }

  return NextResponse.json({
    ok: true,
    content_idea_id: contentIdeaId,
    variants_generated: variants.length,
    variants_saved: saved.length,
    variants: saved,
  });
}
