import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MONTHLY_TARGET = 10000;

/** GET /api/revenue — aggregate revenue across brand deals + income sources */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();

  const [brandsRes, incomeRes] = await Promise.all([
    // Brand deal revenue (closed_won actual_value + referral estimated)
    supabase
      .from("brand_deals")
      .select("brand_name, status, actual_value, estimated_value_low, estimated_value_high, deal_type")
      .eq("user_id", user.id)
      .in("status", ["closed_won", "referral_active"]),
    // Income sources (Motus, affiliate, etc.)
    supabase
      .from("financial_income")
      .select("source, label, amount, frequency, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true),
  ]);

  const brands = brandsRes.data ?? [];
  const income = incomeRes.data ?? [];

  // Brand revenue
  const brandRevenue = brands.reduce((sum, b) => {
    if (b.status === "closed_won" && b.actual_value) return sum + b.actual_value;
    if (b.status === "referral_active") return sum + (b.estimated_value_low ?? 0);
    return sum;
  }, 0);

  // Pipeline value (active deals not yet closed)
  const { data: pipeline } = await supabase
    .from("brand_deals")
    .select("estimated_value_low, estimated_value_high")
    .eq("user_id", user.id)
    .not("status", "in", '("archived","closed_lost","closed_won","referral_active")');

  const pipelineValueLow = (pipeline ?? []).reduce((s, d) => s + (d.estimated_value_low ?? 0), 0);
  const pipelineValueHigh = (pipeline ?? []).reduce((s, d) => s + (d.estimated_value_high ?? 0), 0);

  // App/affiliate income (monthly estimate)
  const freqMultiplier: Record<string, number> = { weekly: 4.33, biweekly: 2.17, semimonthly: 2, monthly: 1, quarterly: 0.33, annual: 0.083, one_time: 0 };
  const appRevenue = income
    .filter((i) => /motus|app|subscription/i.test(i.source ?? "") || /motus|app/i.test(i.label ?? ""))
    .reduce((sum, i) => sum + (i.amount ?? 0) * (freqMultiplier[i.frequency] ?? 1), 0);

  const affiliateRevenue = income
    .filter((i) => /affiliate|referral/i.test(i.source ?? "") || /affiliate|referral/i.test(i.label ?? ""))
    .reduce((sum, i) => sum + (i.amount ?? 0) * (freqMultiplier[i.frequency] ?? 1), 0);

  const totalMonthly = brandRevenue + appRevenue + affiliateRevenue;

  return NextResponse.json({
    brand_revenue: brandRevenue,
    app_revenue: Math.round(appRevenue * 100) / 100,
    affiliate_revenue: Math.round(affiliateRevenue * 100) / 100,
    pipeline_value_low: pipelineValueLow,
    pipeline_value_high: pipelineValueHigh,
    total_monthly: Math.round(totalMonthly * 100) / 100,
    target: MONTHLY_TARGET,
    progress_pct: Math.round((totalMonthly / MONTHLY_TARGET) * 100),
    brands_closed: brands.filter((b) => b.status === "closed_won").length,
    brands_active: (pipeline ?? []).length,
  });
}
