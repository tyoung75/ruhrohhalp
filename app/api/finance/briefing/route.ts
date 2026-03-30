import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { calculateCashFlow, calculateNetWorth, projectDebtPayoff, resolveAllContributions } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";

type Owner = "tyler" | "spouse" | "joint" | "business";

function ownerSummary(accounts: Array<{ owner: Owner; balance: number }>, debts: Array<{ owner: Owner; balance: number; status: string }>) {
  const assetByOwner = { tyler: 0, spouse: 0, joint: 0, business: 0 };
  const debtByOwner = { tyler: 0, spouse: 0, joint: 0, business: 0 };

  for (const account of accounts) {
    assetByOwner[account.owner] += Number(account.balance);
  }

  for (const debt of debts) {
    if (debt.status !== "active") continue;
    debtByOwner[debt.owner] += Number(debt.balance);
  }

  return (Object.keys(assetByOwner) as Owner[]).map((owner) => ({
    owner,
    assets: assetByOwner[owner],
    liabilities: debtByOwner[owner],
    netWorth: assetByOwner[owner] - debtByOwner[owner],
  }));
}

function buildRecommendations(params: {
  debts: Array<{ name: string; apr: number; dueDate: number | null; balance: number; creditLimit: number | null; debtType: string }>;
  cashFlow: { monthlySurplus: number };
  summary: { cashPosition: number };
  rsuVests: Array<{ vestDate: string; estimatedValue: number | null; shares: number; symbol: string; status: string }>;
  contributions: Array<{ contributionType: string; isActive: boolean; amount: number; isPercentage: boolean }>;
}) {
  const recommendations: string[] = [];
  const now = new Date();

  for (const debt of params.debts) {
    if (debt.apr >= 18 && debt.balance > 0) {
      recommendations.push(`High APR alert: ${debt.name} is at ${debt.apr.toFixed(2)}% APR. Prioritize accelerated payoff.`);
    }

    if (debt.creditLimit && debt.creditLimit > 0) {
      const utilization = (debt.balance / debt.creditLimit) * 100;
      if (utilization >= 30) {
        recommendations.push(`${debt.name} utilization is ${utilization.toFixed(1)}%. Bring below 30% to reduce risk.`);
      }
    }

    if (debt.dueDate && debt.dueDate >= 1 && debt.dueDate <= 31) {
      const daysUntilDue = debt.dueDate - now.getDate();
      if (daysUntilDue <= 7) {
        recommendations.push(`${debt.name} payment due on day ${debt.dueDate}. Schedule payment now.`);
      }
    }
  }

  const nextVest = params.rsuVests
    .filter((v) => v.status === "pending")
    .sort((a, b) => new Date(a.vestDate).getTime() - new Date(b.vestDate).getTime())[0];

  if (nextVest) {
    recommendations.push(
      `Next RSU vest: ${nextVest.shares} ${nextVest.symbol} on ${nextVest.vestDate}. Plan taxes/diversification before vest date.`
    );
  }

  const hasRoth = params.contributions.some((c) => c.isActive && c.contributionType === "roth_ira");
  if (!hasRoth) {
    recommendations.push("No active Roth IRA contribution found. Consider enabling recurring monthly Roth contributions.");
  }

  const pctContribs = params.contributions.filter((c) => c.isActive && c.isPercentage);
  if (pctContribs.length === 0) {
    recommendations.push("No percentage-based contributions configured. Consider automating contributions as a percent of income.");
  }

  if (params.summary.cashPosition < 5000) {
    recommendations.push("Low cash warning: cash position is below $5,000. Rebuild emergency buffer.");
  }

  if (params.cashFlow.monthlySurplus < 0) {
    recommendations.push("Monthly cash flow is negative. Reduce variable spend or contribution cadence to avoid debt growth.");
  }

  return recommendations;
}

export async function GET(request: NextRequest) {
  const webhookSecret = request.headers.get("x-webhook-secret");
  let userId: string | null = null;

  if (webhookSecret) {
    const webhookError = validateWebhookSecret(webhookSecret);
    if (webhookError) return webhookError;

    userId = new URL(request.url).searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id query parameter required for webhook calls" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (response || !user) return response;
    userId = user.id;
  }

  const supabase = await createClient();
  const [accountsRes, holdingsRes, incomeRes, debtsRes, contribsRes, rsuRes, configRes] = await Promise.all([
    supabase.from("financial_accounts").select("*").eq("user_id", userId).order("owner"),
    supabase.from("financial_holdings").select("*").eq("user_id", userId).order("current_value", { ascending: false }),
    supabase.from("financial_income").select("*").eq("user_id", userId).order("owner"),
    supabase.from("financial_debts").select("*").eq("user_id", userId).order("balance", { ascending: false }),
    supabase.from("financial_contributions").select("*").eq("user_id", userId).order("owner"),
    supabase.from("financial_rsu_vests").select("*").eq("user_id", userId).order("vest_date", { ascending: true }),
    supabase.from("financial_config").select("*").eq("user_id", userId),
  ]);

  const accounts = accountsRes.data ?? [];
  const holdings = holdingsRes.data ?? [];
  const income = incomeRes.data ?? [];
  const debts = debtsRes.data ?? [];
  const contributions = contribsRes.data ?? [];
  const rsuVests = rsuRes.data ?? [];
  const config = configRes.data ?? [];

  const annualSalary = Number(config.find((c) => c.key === "annual_salary")?.value ?? "247800");
  const monthlyExpenses = Number(config.find((c) => c.key === "monthly_expenses")?.value ?? "0");
  const taxRate = Number(config.find((c) => c.key === "tax_rate")?.value ?? "0.30");

  const mappedAccounts = accounts.map((a) => ({
    owner: a.owner as Owner,
    balance: Number(a.balance),
    accountName: a.account_name,
    institution: a.institution,
    accountType: a.account_type,
  }));

  const mappedDebts = debts.map((d) => ({
    owner: d.owner as Owner,
    name: d.name,
    institution: d.institution,
    balance: Number(d.balance),
    apr: Number(d.apr),
    minPayment: Number(d.min_payment),
    debtType: d.debt_type,
    status: d.status,
    dueDate: d.due_date,
    creditLimit: d.credit_limit ? Number(d.credit_limit) : null,
  }));

  const mappedIncome = income.map((i) => ({
    amount: Number(i.amount),
    frequency: i.frequency,
    isActive: i.is_active,
  }));

  const mappedContributions = contributions.map((c) => ({
    owner: c.owner as Owner,
    destination: c.destination,
    amount: Number(c.amount),
    isPercentage: c.is_percentage ?? false,
    frequency: c.frequency,
    isActive: c.is_active,
    contributionType: c.contribution_type,
    dayOfMonth: c.day_of_month,
  }));

  const mappedRsu = rsuVests.map((r) => ({
    owner: r.owner as Owner,
    symbol: r.symbol,
    shares: Number(r.shares),
    vestDate: r.vest_date,
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : null,
    status: r.status,
  }));

  const summary = calculateNetWorth(
    accounts.map((a) => ({
      id: a.id,
      userId: a.user_id,
      owner: a.owner,
      accountName: a.account_name,
      institution: a.institution,
      accountType: a.account_type,
      balance: Number(a.balance),
      currency: a.currency,
      notes: a.notes,
      lastSynced: a.last_synced,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
    debts.map((d) => ({
      id: d.id,
      userId: d.user_id,
      owner: d.owner,
      name: d.name,
      institution: d.institution,
      balance: Number(d.balance),
      creditLimit: d.credit_limit ? Number(d.credit_limit) : null,
      apr: Number(d.apr),
      minPayment: Number(d.min_payment),
      debtType: d.debt_type,
      status: d.status,
      dueDate: d.due_date,
      notes: d.notes,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    rsuVests.map((r) => ({
      id: r.id,
      userId: r.user_id,
      owner: r.owner,
      symbol: r.symbol,
      shares: Number(r.shares),
      vestDate: r.vest_date,
      grantId: r.grant_id,
      awardDate: r.award_date,
      currentPrice: r.current_price ? Number(r.current_price) : null,
      estimatedValue: r.estimated_value ? Number(r.estimated_value) : null,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );

  const cashFlow = calculateCashFlow(
    mappedIncome.map((i) => ({ ...i, id: "", userId: "", owner: "joint", source: "", label: "", effectiveDate: null, notes: null, createdAt: "", updatedAt: "" })),
    mappedDebts.map((d) => ({ ...d, id: "", userId: "", notes: null, createdAt: "", updatedAt: "" })),
    mappedContributions.map((c) => ({ ...c, id: "", userId: "", accountId: null, notes: null, createdAt: "", updatedAt: "" })),
    annualSalary,
    monthlyExpenses,
    taxRate
  );

  const debtProjections = mappedDebts
    .filter((d) => d.status === "active")
    .map((d) => projectDebtPayoff({ ...d, id: "", userId: "", notes: null, createdAt: "", updatedAt: "" }, d.minPayment));

  const utilizationAlerts = mappedDebts
    .filter((d) => d.creditLimit && d.creditLimit > 0)
    .map((d) => ({
      debtName: d.name,
      utilizationPercent: (d.balance / Number(d.creditLimit)) * 100,
      thresholdExceeded: (d.balance / Number(d.creditLimit)) * 100 >= 30,
    }))
    .filter((a) => a.thresholdExceeded)
    .sort((a, b) => b.utilizationPercent - a.utilizationPercent);

  const upcomingRsuVests = mappedRsu
    .filter((r) => r.status === "pending" && new Date(r.vestDate) >= new Date())
    .slice(0, 6);

  const topHoldings = holdings
    .map((h) => ({
      symbol: h.symbol,
      name: h.name,
      value: Number(h.current_value),
      shares: Number(h.shares),
      accountId: h.account_id,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const ownerBreakdown = ownerSummary(mappedAccounts, mappedDebts);
  const contributionSummary = resolveAllContributions(
    contributions.map((c) => ({
      id: c.id,
      userId: c.user_id,
      owner: c.owner,
      destination: c.destination,
      accountId: c.account_id,
      amount: Number(c.amount),
      isPercentage: c.is_percentage ?? false,
      frequency: c.frequency,
      contributionType: c.contribution_type,
      isActive: c.is_active,
      dayOfMonth: c.day_of_month,
      notes: c.notes,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    annualSalary
  );

  const recommendations = buildRecommendations({
    debts: mappedDebts,
    cashFlow,
    summary,
    rsuVests: mappedRsu,
    contributions: mappedContributions,
  });

  return NextResponse.json({
    asOf: new Date().toISOString(),
    netWorth: {
      summary,
      byOwner: ownerBreakdown,
    },
    accounts: {
      total: mappedAccounts.length,
      balances: mappedAccounts,
    },
    holdings: {
      total: holdings.length,
      top: topHoldings,
    },
    debt: {
      totalActiveDebts: mappedDebts.filter((d) => d.status === "active").length,
      balances: mappedDebts,
      projections: debtProjections,
      utilizationAlerts,
    },
    rsu: {
      upcomingVests: upcomingRsuVests,
    },
    cashFlow,
    contributions: {
      totalMonthly: contributionSummary.totalMonthly,
      totalAnnual: contributionSummary.totalAnnual,
      resolved: contributionSummary.resolved,
      upcomingDates: mappedContributions
        .filter((c) => c.isActive && c.dayOfMonth)
        .map((c) => ({ destination: c.destination, dayOfMonth: c.dayOfMonth, owner: c.owner })),
    },
    recommendations,
  });
}
