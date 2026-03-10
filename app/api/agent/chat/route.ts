import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { agentChatSchema } from "@/lib/validation";
import { MODELS } from "@/lib/ai/registry";
import { getTierForUser } from "@/lib/profile";
import { isModelAllowedForTier } from "@/lib/tiers";
import { chatWithTaskAgent } from "@/lib/ai/service";
import { limitByKey } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const rl = limitByKey(`agent:${user.id}`, 45, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await request.json();
  const parsed = agentChatSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const model = MODELS[parsed.data.modelId];
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 400 });

  const tier = await getTierForUser(user.id);
  if (!isModelAllowedForTier(tier, model.id)) {
    return NextResponse.json({ error: "Model not available for current plan" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", parsed.data.taskId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const { data: openRows } = await supabase
    .from("tasks")
    .select("title,type")
    .eq("user_id", user.id)
    .eq("status", "open")
    .neq("id", task.id)
    .order("created_at", { ascending: false })
    .limit(6);

  const contextItems = (openRows ?? []).map((i) => `- [${i.type}] ${i.title}`).join("\n") || "None";

  const system = `You are a dedicated task execution agent inside ruhrohhalp.\n\nFocus only on this item:\nType: ${task.type}\nPriority: ${task.priority}\nTitle: ${task.title}\nDescription: ${task.description || "None"}\nHowTo: ${task.how_to || "Not provided"}\nAudit Notes: ${task.audit_notes || "None"}\n\nOther open items:\n${contextItems}\n\nBe concise, concrete, and execution-oriented.`;

  const reply = await chatWithTaskAgent({
    userId: user.id,
    tier,
    provider: model.provider,
    modelId: model.id,
    system,
    messages: parsed.data.messages,
  });

  const newestUserMessage = parsed.data.messages[parsed.data.messages.length - 1];
  await supabase.from("task_messages").insert([
    {
      task_id: task.id,
      user_id: user.id,
      model_id: model.id,
      role: newestUserMessage.role,
      content: newestUserMessage.content,
    },
    {
      task_id: task.id,
      user_id: user.id,
      model_id: model.id,
      role: "assistant",
      content: reply,
    },
  ]);

  return NextResponse.json({ message: reply, modelId: model.id, provider: model.provider });
}
