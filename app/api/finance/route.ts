import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calculateNetWorth, calculateCashFlow } from "@/lib/finance";

/**
 * GET /api/finance
 *
 * Returns the complete financial dashboard data:
 * accounts, holdings, income, debts, contributions, RSU vests, alerts,
 * snapshots, and computed summaries.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();

  const [accountsRes, holdingsRes, incomeRes, debtsRes, contribsRes, rsusRes, alertsRes, snapshotsRes, configRes] =
    await Promise.all([
      supabase.from("financial_accounts").select("*").eq("user_id", user.id).order("owner").order("institution"),
      supabase.from("financial_holdings").select("*").eq("user_id", user.id).order("symbol"),
      supabase.from("financial_income").select("*").eq("user_id", user.id).order("owner").order("source"),
      supabase.from("financial_debts").select("*").eq("user_id", user.id).order("owner").order("balance", { ascending: false }),
      supabase.from("financial_contributions").select("*").eq("user_id", user.id).order("owner").order("destination"),
      supabase.from("financial_rsu_vests").select("*").eq("user_id", user.id).order("vest_date", { ascending: true }),
      supabase.from("financial_alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("financial_snapshots").select("*").eq("user_id", user.id).order("snapshot_date", { ascending: false }).limit(90),
      supabase.from("financial_config").select("*").eq("user_id", user.id),
    ]);

  const accounts = accountsRes.data ?? [];
  const holdings = holdingsRes.data ?? [];
  const income = incomeRes.data ?? [];
  const debts = debtsRes.data ?? [];
  const contributions = contribsRes.data ?? [];
  const rsuVests = rsusRes.data ?? [];
  const alerts = alertsRes.data ?? [];
  const snapshots = snapshotsRes.data ?? [];
  const config = configRes.data ?? [];

  const taxRate = Number(config.find((c) => c.key === "tax_rate")?.value ?? "0.30");
  const monthlyExpenses = Number(config.find((c) => c.key === "monthly_expenses")?.value ?? "0");
  const annualSalary = Number(config.find((c) => c.key === "annual_salary")?.value ?? "232800");

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapAccount = (a: any) => ({
    id: a.id, userId: a.user_id, owner: a.owner, accountName: a.account_name,
    institution: a.institution, accountType: a.account_type, balance: Number(a.balance),
    currency: a.currency, notes: a.notes, lastSynced: a.last_synced,
    createdAt: a.created_at, updatedAt: a.updated_at,
  });
  const mapIncome = (i: any) => ({
    id: i.id, userId: i.user_id, owner: i.owner, source: i.source, label: i.label,
    amount: Number(i.amount), frequency: i.frequency, isActive: i.is_active,
    effectiveDate: i.effective_date, notes: i.notes, createdAt: i.created_at, updatedAt: i.updated_at,
  });
  const mapDebt = (d: any) => ({
    id: d.id, userId: d.user_id, owner: d.owner, name: d.name, institution: d.institution,
    balance: Number(d.balance), creditLimit: d.credit_limit ? Number(d.credit_limit) : null,
    apr: Number(d.apr), minPayment: Number(d.min_payment), debtType: d.debt_type,
    status: d.status, dueDate: d.due_date, notes: d.notes, createdAt: d.created_at, updatedAt: d.updated_at,
  });
  const mapContribution = (c: any) => ({
    id: c.id, userId: c.user_id, owner: c.owner, destination: c.destination, accountId: c.account_id,
    amount: Number(c.amount), isPercentage: c.is_percentage ?? false,
    frequency: c.frequency, contributionType: c.contribution_type ?? "investment",
    isActive: c.is_active, dayOfMonth: c.day_of_month, notes: c.notes,
    createdAt: c.created_at, updatedAt: c.updated_at,
  });
  const mapRSU = (r: any) => ({
    id: r.id, userId: r.user_id, owner: r.owner, symbol: r.symbol, shares: Number(r.shares),
    vestDate: r.vest_date, grantId: r.grant_id, awardDate: r.award_date,
    currentPrice: r.current_price ? Number(r.current_price) : null,
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : null,
    status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const mapAlert = (a: any) => ({
    id: a.id, userId: a.user_id, debtId: a.debt_id, accountId: a.account_id,
    alertType: a.alert_type, rule: a.rule, message: a.message, isActive: a.is_active,
    lastTriggered: a.last_triggered, createdAt: a.created_at, updatedAt: a.updated_at,
  });
  const mapHolding = (h: any) => ({
    id: h.id, accountId: h.account_id, userId: h.user_id, symbol: h.symbol, name: h.name,
    shares: Number(h.shares), currentPrice: h.current_price ? Number(h.current_price) : null,
    currentValue: Number(h.current_value), costBasis: h.cost_basis ? Number(h.cost_basis) : null,
    holdingType: h.holding_type, createdAt: h.created_at, updatedAt: h.updated_at,
  });
  const mapSnapshot = (s: any) => ({
    id: s.id, userId: s.user_id, snapshotDate: s.snapshot_date,
    totalAssets: Number(s.total_assets), totalLiabilities: Number(s.total_liabilities),
    netWorth: Number(s.net_worth), cashPosition: Number(s.cash_position),
    breakdown: s.breakdown, createdAt: s.created_at,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const mappedAccounts = accounts.map(mapAccount);
  const mappedIncome = income.map(mapIncome);
  const mappedDebts = debts.map(mapDebt);
  const mappedContributions = contributions.map(mapContribution);
  const mappedRSUs = rsuVests.map(mapRSU);

  const summary = calculateNetWorth(mappedAccounts, mappedDebts, mappedRSUs);
  const cashFlow = calculateCashFlow(mappedIncome, mappedDebts, mappedContributions, annualSalary, monthlyExpenses, taxRate);

  return NextResponse.json({
    accounts: mappedAccounts,
    holdings: holdings.map(mapHolding),
    income: mappedIncome,
    debts: mappedDebts,
    contributions: mappedContributions,
    rsuVests: mappedRSUs,
    alerts: alerts.map(mapAlert),
    snapshots: snapshots.map(mapSnapshot),
    summary,
    cashFlow,
    config: Object.fromEntries(config.map((c) => [c.key, c.value])),
  });
}

/**
 * POST /api/finance — Create a financial record
 * Body: { type: "account"|"income"|"debt"|"contribution"|"rsu"|"config"|"alert", data: {...} }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { type, data } = body;
  if (!type || !data) return NextResponse.json({ error: "type and data are required" }, { status: 400 });

  const TABLE_MAP: Record<string, string> = {
    account: "financial_accounts", income: "financial_income", debt: "financial_debts",
    contribution: "financial_contributions", rsu: "financial_rsu_vests",
    config: "financial_config", alert: "financial_alerts",
  };
  const table = TABLE_MAP[type];
  if (!table) return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });

  const supabase = await createClient();
  const now = new Date().toISOString();
  const record = { ...data, user_id: user.id, created_at: now, updated_at: now };

  const { data: inserted, error } = await supabase.from(table).insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ record: inserted }, { status: 201 });
}

/**
 * PATCH /api/finance — Update a financial record
 * Body: { type, id, data }
 */
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { type, id, data } = body;
  if (!type || !id || !data) return NextResponse.json({ error: "type, id, and data are required" }, { status: 400 });

  const TABLE_MAP: Record<string, string> = {
    account: "financial_accounts", income: "financial_income", debt: "financial_debts",
    contribution: "financial_contributions", rsu: "financial_rsu_vests",
    config: "financial_config", alert: "financial_alerts",
  };
  const table = TABLE_MAP[type];
  if (!table) return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from(table)
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", user.id).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: updated });
}
