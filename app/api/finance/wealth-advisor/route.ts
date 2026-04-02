import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTierForUser } from "@/lib/profile";
import { getUserProviderKey } from "@/lib/ai/credentials";
import { callProvider } from "@/lib/ai/providers";
import { buildWealthAdvisorSummary, calculateCashFlow, calculateNetWorth } from "@/lib/finance";
import type { WealthAdvisorSummary } from "@/lib/types/finance";

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === "42P01" || maybe.message?.includes("schema cache") || maybe.message?.includes("Could not find the table") || false;
}

function safeParseAdvisorResponse(raw: string): WealthAdvisorSummary | null {
  try {
    const parsed = JSON.parse(raw) as WealthAdvisorSummary;
    if (!Array.isArray(parsed.dailyBriefing) || !Array.isArray(parsed.deepAnalysis)) return null;
    return {
      ...parsed,
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      portfolioAlerts: parsed.portfolioAlerts ?? [],
      underlyingInsights: parsed.underlyingInsights ?? [],
      optimizationPlan: parsed.optimizationPlan ?? [],
      taxOptimization: parsed.taxOptimization ?? [],
      budgetOptimization: parsed.budgetOptimization ?? [],
      adaptationLoop: parsed.adaptationLoop ?? [],
      statementIngestion: parsed.statementIngestion ?? { recentStatements: 0, lastStatementAt: null, latestAccounts: [] },
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const [accountsRes, holdingsRes, incomeRes, debtsRes, contribsRes, rsusRes, configRes, statementsRes, memoryRes] = await Promise.all([
    supabase.from("financial_accounts").select("*").eq("user_id", user.id),
    supabase.from("financial_holdings").select("*").eq("user_id", user.id),
    supabase.from("financial_income").select("*").eq("user_id", user.id),
    supabase.from("financial_debts").select("*").eq("user_id", user.id),
    supabase.from("financial_contributions").select("*").eq("user_id", user.id),
    supabase.from("financial_rsu_vests").select("*").eq("user_id", user.id),
    supabase.from("financial_config").select("*").eq("user_id", user.id),
    supabase.from("financial_statement_ingestions").select("*").eq("user_id", user.id).order("uploaded_at", { ascending: false }).limit(36),
    supabase.from("financial_advisor_memory").select("memory_type,title,content,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
  ]);

  const accounts = (accountsRes.data ?? []).map((a) => ({
    id: a.id, userId: a.user_id, owner: a.owner, accountName: a.account_name, institution: a.institution,
    accountType: a.account_type, balance: Number(a.balance), currency: a.currency, notes: a.notes,
    lastSynced: a.last_synced, createdAt: a.created_at, updatedAt: a.updated_at,
  }));
  const holdings = (holdingsRes.data ?? []).map((h) => ({
    id: h.id, accountId: h.account_id, userId: h.user_id, symbol: h.symbol, name: h.name, shares: Number(h.shares),
    currentPrice: h.current_price ? Number(h.current_price) : null, currentValue: Number(h.current_value),
    costBasis: h.cost_basis ? Number(h.cost_basis) : null, holdingType: h.holding_type, createdAt: h.created_at, updatedAt: h.updated_at,
  }));
  const income = (incomeRes.data ?? []).map((i) => ({
    id: i.id, userId: i.user_id, owner: i.owner, source: i.source, label: i.label, amount: Number(i.amount),
    frequency: i.frequency, isActive: i.is_active, effectiveDate: i.effective_date, notes: i.notes, createdAt: i.created_at, updatedAt: i.updated_at,
  }));
  const debts = (debtsRes.data ?? []).map((d) => ({
    id: d.id, userId: d.user_id, owner: d.owner, name: d.name, institution: d.institution, balance: Number(d.balance),
    creditLimit: d.credit_limit ? Number(d.credit_limit) : null, apr: Number(d.apr), minPayment: Number(d.min_payment),
    debtType: d.debt_type, status: d.status, dueDate: d.due_date, notes: d.notes, createdAt: d.created_at, updatedAt: d.updated_at,
  }));
  const contributions = (contribsRes.data ?? []).map((c) => ({
    id: c.id, userId: c.user_id, owner: c.owner, destination: c.destination, accountId: c.account_id,
    amount: Number(c.amount), isPercentage: c.is_percentage ?? false, frequency: c.frequency,
    contributionType: c.contribution_type, isActive: c.is_active, dayOfMonth: c.day_of_month,
    notes: c.notes, createdAt: c.created_at, updatedAt: c.updated_at,
  }));
  const rsuVests = (rsusRes.data ?? []).map((r) => ({
    id: r.id, userId: r.user_id, owner: r.owner, symbol: r.symbol, shares: Number(r.shares), vestDate: r.vest_date,
    grantId: r.grant_id, awardDate: r.award_date, currentPrice: r.current_price ? Number(r.current_price) : null,
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : null, status: r.status, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
  const statements = (statementsRes.data ?? []).map((s) => ({
    id: s.id, userId: s.user_id, accountName: s.account_name, institution: s.institution, statementMonth: s.statement_month,
    fileName: s.file_name, contentType: s.content_type, bytes: Number(s.bytes ?? 0), ingestionStatus: s.ingestion_status,
    ingestionNotes: s.ingestion_notes, extractedText: s.extracted_text, uploadedAt: s.uploaded_at, updatedAt: s.updated_at,
  }));

  const taxRate = Number((configRes.data ?? []).find((c) => c.key === "tax_rate")?.value ?? "0.30");
  const monthlyExpenses = Number((configRes.data ?? []).find((c) => c.key === "monthly_expenses")?.value ?? "0");
  const annualSalary = Number((configRes.data ?? []).find((c) => c.key === "annual_salary")?.value ?? "247800");

  const summary = calculateNetWorth(accounts, debts, rsuVests);
  const cashFlow = calculateCashFlow(income, debts, contributions, annualSalary, monthlyExpenses, taxRate);
  const deterministic = buildWealthAdvisorSummary({ summary, cashFlow, debts, holdings, contributions, statements });

  const tier = await getTierForUser(user.id);
  const key = await getUserProviderKey(user.id, tier, "chatgpt");

  if (!key) {
    return NextResponse.json({ advisor: deterministic, source: "rules" });
  }

  const latestMemories = (memoryRes.data ?? []).map((m) => ({
    type: m.memory_type,
    title: m.title,
    createdAt: m.created_at,
    content: m.content,
  }));

  const promptPayload = {
    generatedAt: new Date().toISOString(),
    summary,
    cashFlow,
    debts: debts.slice(0, 20),
    holdings: holdings.slice(0, 30),
    contributions,
    statements: statements.slice(0, 12).map((s) => ({
      accountName: s.accountName,
      statementMonth: s.statementMonth,
      uploadedAt: s.uploadedAt,
      notes: s.ingestionNotes,
    })),
    historicalMemory: latestMemories,
    constraints: {
      monthlyCadence: true,
      objective: "maximize long-run after-tax return",
      includeBudgetGuidance: true,
      includeAccountLevelOptimization: true,
    },
  };

  const system = `You are a fiduciary-style wealth advisor inside Tyler OS. Return STRICT JSON only with keys: generatedAt, dailyBriefing, deepAnalysis, portfolioAlerts, underlyingInsights, optimizationPlan, taxOptimization, budgetOptimization, adaptationLoop, statementIngestion.
Each array should contain concise bullet strings.
Respect monthly decision cadence (do not recommend daily trading). Use historicalMemory feedback to adapt recommendations.`;

  const raw = await callProvider({
    provider: "chatgpt",
    modelId: "gpt-4o",
    apiKey: key,
    system,
    messages: [{ role: "user", content: JSON.stringify(promptPayload) }],
  });

  const advisor = safeParseAdvisorResponse(raw) ?? deterministic;

  const { error: insertError } = await supabase.from("financial_advisor_memory").insert({
    user_id: user.id,
    memory_type: "advisor_snapshot",
    title: "wealth_advisor_snapshot",
    content: {
      advisor,
      summary: {
        netWorth: summary.netWorth,
        monthlySurplus: cashFlow.monthlySurplus,
      },
    },
  });

  if (insertError && !isMissingTableError(insertError)) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const warnings = [];
  if (memoryRes.error && isMissingTableError(memoryRes.error)) warnings.push("financial_advisor_memory table missing; using stateless mode");
  if (insertError && isMissingTableError(insertError)) warnings.push("advisor memory snapshot not persisted");

  return NextResponse.json({ advisor, source: "chatgpt", warnings });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => ({}));
  const feedback = typeof body.feedback === "string" ? body.feedback.slice(0, 4000) : "";
  const decision = typeof body.decision === "string" ? body.decision.slice(0, 300) : "";

  if (!feedback) return NextResponse.json({ error: "feedback is required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("financial_advisor_memory").insert({
    user_id: user.id,
    memory_type: "user_feedback",
    title: decision || "advisor_feedback",
    content: { feedback, decision, capturedAt: new Date().toISOString() },
  });

  if (error && isMissingTableError(error)) {
    return NextResponse.json({ ok: true, warning: "financial_advisor_memory table missing; feedback not persisted" });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
