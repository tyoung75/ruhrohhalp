import { createAdminClient } from "@/lib/supabase/admin";
import type { BrandDeal, BrandDealStatus, BrandOutreachEmail, PipelineSummary } from "@/lib/types/brands";

const ACTIVE_EXCLUDE = ["archived", "closed_lost"];

export async function getActivePipeline(userId: string): Promise<BrandDeal[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("user_id", userId)
    .not("status", "in", `(${ACTIVE_EXCLUDE.map((s) => `\"${s}\"`).join(",")})`)
    .order("priority", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandDeal[];
}

export async function getDueFollowUps(userId: string): Promise<BrandDeal[]> {
  const supabase = createAdminClient();
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["sent", "follow_up_1"])
    .lt("last_contact_date", tenDaysAgo)
    .lt("follow_up_count", 2)
    .order("last_contact_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandDeal[];
}

export async function getStaleDeals(userId: string): Promise<BrandDeal[]> {
  const supabase = createAdminClient();
  const threshold = new Date(Date.now() - 21 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("user_id", userId)
    .lt("last_contact_date", threshold)
    .gte("follow_up_count", 2)
    .neq("status", "archived");
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandDeal[];
}

export async function getProspects(userId: string): Promise<BrandDeal[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "prospect")
    .order("priority", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandDeal[];
}

export async function getReplied(userId: string): Promise<BrandDeal[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "replied")
    .order("last_reply_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandDeal[];
}

export async function updateDealStatus(dealId: string, status: BrandDealStatus, updates?: Partial<BrandDeal>) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("brand_deals")
    .update({ ...updates, status, updated_at: new Date().toISOString() })
    .eq("id", dealId);
  if (error) throw new Error(error.message);
}

export async function archiveDeal(dealId: string, reason: string) {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("brand_deals")
    .update({ status: "archived", archived_at: now, archive_reason: reason, updated_at: now })
    .eq("id", dealId);
  if (error) throw new Error(error.message);
}

export async function recordEmail(email: Omit<BrandOutreachEmail, "id" | "created_at">) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("brand_outreach_emails").insert(email);
  if (error) throw new Error(error.message);
}

export async function getPipelineSummary(userId: string): Promise<PipelineSummary> {
  const supabase = createAdminClient();
  const [{ data: deals }, { data: due }, { data: replies }, { data: drafts }] = await Promise.all([
    supabase.from("brand_deals").select("*").eq("user_id", userId).neq("status", "archived"),
    supabase.from("brand_deals").select("*").eq("user_id", userId).in("status", ["sent", "follow_up_1"]).lte("next_action_date", new Date().toISOString().slice(0, 10)),
    supabase.from("brand_deals").select("*").eq("user_id", userId).eq("status", "replied").gte("last_reply_date", new Date(Date.now() - 86400000).toISOString()),
    supabase.from("brand_deals").select("*").eq("user_id", userId).eq("status", "draft_ready").gte("updated_at", new Date(new Date().toDateString()).toISOString()),
  ]);

  const all = (deals ?? []) as BrandDeal[];
  const byStatus = all.reduce((acc, deal) => {
    acc[deal.status] = (acc[deal.status] ?? 0) + 1;
    return acc;
  }, {} as Record<BrandDealStatus, number>);

  return {
    total_active: all.filter((d) => !ACTIVE_EXCLUDE.includes(d.status)).length,
    by_status: byStatus,
    estimated_value_low: all.reduce((sum, d) => sum + (d.estimated_value_low ?? 0), 0),
    estimated_value_high: all.reduce((sum, d) => sum + (d.estimated_value_high ?? 0), 0),
    follow_ups_due: (due ?? []) as BrandDeal[],
    recent_replies: (replies ?? []) as BrandDeal[],
    drafts_today: (drafts ?? []) as BrandDeal[],
  };
}

export async function createFollowUpTask(userId: string, brand: BrandDeal) {
  const supabase = createAdminClient();
  const dueDate = brand.next_action_date ?? new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const { error } = await supabase.from("tasks").insert({
    user_id: userId,
    title: `Follow up with ${brand.brand_name}`,
    description: `Check outreach status for ${brand.brand_name}. Next action: ${brand.next_action ?? "follow up"}`,
    due_date: dueDate,
    priority: "high",
    status: "open",
    state: "unstarted",
    type: "task",
    source_text: "brand-outreach-pipeline",
  });
  if (error) throw new Error(error.message);
}
