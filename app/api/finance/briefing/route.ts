import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";
import { calculateNetWorth, calculateCashFlow, projectDebtPayoff } from "@/lib/finance";

/**
 * GET /api/finance/briefing
 *
 * Webhook-authenticated endpoint for the Command Center Daily Brief.
 * Returns a condensed financial summary including:
 * - Net worth breakdown (household, Tyler, spouse, business)
 * - Account balances by type
 * - Debt summary with payoff projections
 * - Upcoming RSU vests
 * - Contribution tracking
 * - Cash flow summary
 * - Actionable alerts and recommendations
 *
 * Auth: x-webhook-secret header (same as tasks API)
 */
export async function GET(request: NextRequest) {
  const webhookError = validateWebhookSecret(
    request.headers.get("x-webhook-secret")
  );
  if (webhookError) return webhookError;

  const supabase = await createClient();

  // Get Tyler's user ID from financial_accounts (first record)
  const { data: anyAccount } = await supabase
    .from("financial_accounts")
    .select("user_id")
    .limit(1)
    .single();

  if (!anyAccount) {
    return NextResponse.json(
      { error: "No financial data found" },
      { status: 404 }
    );
  }

  const userId = anyAccount.user_id;

  const [
    accountsRes,
    holdingsRes,
    incomeRes,
    debtsRes,
    contribsRes,
    rsusRes,
    configRes,
    snapshotsRes,
  ] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("owner")
      .order("institution"),
    supabase
      .from("financial_holdings")
      .select("*")
      .eq("user_id", userId)
      .order("current_value", { ascending: false }),
    supabase
      .from("financial_income")
      .select("*")
      .eq("user_id", userId)
      .order("owner"),
    supabase
      .from("financial_debts")
      .select("*")
      .eq("user_id", userId)
      .order("balance", { ascending: false }),
    supabase
      .from("financial_contributions")
      .select("*")
      .eq("user_id", userId)
      .order("owner"),
    supabase
      .from("financial_rsu_vests")
      .select("*")
      .eq("user_id", userId)
      .order("vest_date", { ascending: true }),
    supabase.from("financial_config").select("*").eq("user_id", userId),
    supabase
      .from("financial_snapshots")
      .select("*")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(7),
  ]);

  const accounts = accountsRes.data ?? [];
  const holdings = holdingsRes.data ?? [];
  const income = incomeRes.data ?? [];
  const debts = debtsRes.data ?? [];
  const contributions = contribsRes.data ?? [];
  const rsuVests = rsusRes.data ?? [];
  const config = configRes.data ?? [];
  const snapshots = snapshotsRes.data ?? [];

  const configMap = Object.fromEntries(
    config.map((c) => [c.key, c.value])
  );
  const taxRate = Number(configMap.tax_rate ?? "0.30");
  const monthlyExpenses = Number(configMap.monthly_expenses ?? "0");
  const annualSalary = Number(configMap.annual_salary ?? "247800");

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapAccount = (a: any) => ({
    id: a.id,
    owner: a.owner,
    accountName: a.account_name,
    institution: a.institution,
    accountType: a.account_type,
    balance: Number(a.balance),
    lastSynced: a.last_synced,
    updatedAt: a.updated_at,
  });
  const mapDebt = (d: any) => ({
    id: d.id,
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
  });
  const mapContribution = (c: any) => ({
    id: c.id,
    owner: c.owner,
    destination: c.destination,
    amount: Number(c.amount),
    isPercentage: c.is_percentage ?? false,
    frequency: c.frequency,
    contributionType: c.contribution_type ?? "investment",
    isActive: c.is_active,
    dayOfMonth: c.day_of_month,
    notes: c.notes,
  });
  const mapRSU = (r: any) => ({
    id: r.id,
    owner: r.owner,
    symbol: r.symbol,
    shares: Number(r.shares),
    vestDate: r.vest_date,
    grantId: r.grant_id,
    currentPrice: r.current_price ? Number(r.current_price) : null,
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : null,
    status: r.status,
  });
  const mapIncome = (i: any) => ({
    id: i.id,
    owner: i.owner,
    source: i.source,
    label: i.label,
    amount: Number(i.amount),
    frequency: i.frequency,
    isActive: i.is_active,
  });
  const mapHolding = (h: any) => ({
    accountId: h.account_id,
    symbol: h.symbol,
    name: h.name,
    shares: Number(h.shares),
    currentPrice: h.current_price ? Number(h.current_price) : null,
    currentValue: Number(h.current_value),
    holdingType: h.holding_type,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const mappedAccounts = accounts.map(mapAccount);
  const mappedDebts = debts.map(mapDebt);
  const mappedContributions = contributions.map(mapContribution);
  const mappedRSUs = rsuVests.map(mapRSU);
  const mappedIncome = income.map(mapIncome);
  const mappedHoldings = holdings.map(mapHolding);

  // Net worth calculation
  const summary = calculateNetWorth(
    mappedAccounts as any,
    mappedDebts as any,
    mappedRSUs as any
  );
  const cashFlow = calculateCashFlow(
    mappedIncome as any,
    mappedDebts as any,
    mappedContributions as any,
    annualSalary,
    monthlyExpenses,
    taxRate
  );

  // Upcoming RSU vests (next 90 days)
  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const upcomingVests = mappedRSUs.filter((r) => {
    const vd = new Date(r.vestDate);
    return r.status === "pending" && vd >= now && vd <= ninetyDaysOut;
  });

  // Debt payoff projections
  const debtProjections = mappedDebts
    .filter((d) => d.status === "active" && d.balance > 0)
    .map((d) => {
      const payoff = projectDebtPayoff(d as any, d.minPayment);
      return {
        name: d.name,
        balance: d.balance,
        apr: d.apr,
        minPayment: d.minPayment,
        dueDate: d.dueDate,
        monthsToPayoff: payoff.monthsToPayoff,
        totalInterest: payoff.totalInterestPaid,
        payoffDate: payoff.payoffDate,
      };
    });

  // High-balance debt alerts (utilization > 30%)
  const debtAlerts = mappedDebts
    .filter((d) => {
      if (d.status !== "active" || !d.creditLimit) return false;
      return d.balance / d.creditLimit > 0.3;
    })
    .map((d) => ({
      name: d.name,
      balance: d.balance,
      creditLimit: d.creditLimit,
      utilization: d.creditLimit
        ? Math.round((d.balance / d.creditLimit) * 100)
        : null,
    }));

  // Total monthly debt payments
  const totalMonthlyDebtPayments = mappedDebts
    .filter((d) => d.status === "active")
    .reduce((sum, d) => sum + d.minPayment, 0);

  // Holdings by account for portfolio view
  const holdingsByAccount: Record<string, typeof mappedHoldings> = {};
  for (const h of mappedHoldings) {
    const acct = mappedAccounts.find(
      (a) => a.id === h.accountId
    );
    const key = acct
      ? `${acct.institution} ${acct.accountName}`
      : "Unknown";
    if (!holdingsByAccount[key]) holdingsByAccount[key] = [];
    holdingsByAccount[key].push(h);
  }

  // Top holdings by value
  const topHoldings = mappedHoldings
    .filter((h) => h.holdingType !== "cash")
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, 15);

  // Net worth trend from snapshots
  const netWorthTrend = snapshots.map((s: any) => ({
    date: s.snapshot_date,
    netWorth: Number(s.net_worth),
    totalAssets: Number(s.total_assets),
    totalLiabilities: Number(s.total_liabilities),
  }));

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    netWorth: summary,
    cashFlow,
    accounts: mappedAccounts,
    topHoldings,
    holdingsByAccount,
    debts: {
      items: mappedDebts,
      projections: debtProjections,
      alerts: debtAlerts,
      totalMonthlyPayments: totalMonthlyDebtPayments,
      totalBalance: mappedDebts
        .filter((d) => d.status === "active")
        .reduce((sum, d) => sum + d.balance, 0),
    },
    income: mappedIncome,
    contributions: mappedContributions,
    upcomingVests,
    allVests: mappedRSUs,
    netWorthTrend,
    config: configMap,
    recommendations: generateRecommendations({
      accounts: mappedAccounts,
      debts: mappedDebts,
      debtAlerts,
      contributions: mappedContributions,
      upcomingVests,
      cashFlow,
      config: configMap,
    }),
  });
}

/**
 * Generate actionable financial recommendations for the briefing
 */
function generateRecommendations(data: {
  accounts: any[];
  debts: any[];
  debtAlerts: any[];
  contributions: any[];
  upcomingVests: any[];
  cashFlow: any;
  config: Record<string, string>;
}) {
  const recs: { priority: string; category: string; message: string; action?: string }[] = [];

  // High utilization credit cards
  for (const alert of data.debtAlerts) {
    recs.push({
      priority: "high",
      category: "debt",
      message: `${alert.name} at ${alert.utilization}% utilization ($${alert.balance.toLocaleString()} / $${alert.creditLimit?.toLocaleString()})`,
      action: `Consider paying down to below 30% utilization ($${Math.round((alert.creditLimit ?? 0) * 0.3).toLocaleString()})`,
    });
  }

  // High APR debts
  const highAprDebts = data.debts.filter(
    (d) => d.status === "active" && d.apr > 20 && d.balance > 0
  );
  for (const d of highAprDebts) {
    recs.push({
      priority: "high",
      category: "debt",
      message: `${d.name} has ${d.apr}% APR with $${d.balance.toLocaleString()} balance`,
      action: "Prioritize payoff — high-interest debt erodes wealth fastest",
    });
  }

  // Upcoming RSU vests
  for (const vest of data.upcomingVests) {
    const daysUntil = Math.ceil(
      (new Date(vest.vestDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil <= 30) {
      recs.push({
        priority: "medium",
        category: "rsu",
        message: `${vest.shares} shares of ${vest.symbol} vest in ${daysUntil} days (${vest.vestDate})`,
        action: `Plan for tax withholding (~${Math.round(Number(data.config.tax_rate ?? "0.30") * 100)}%). Decide: hold, sell, or diversify.`,
      });
    }
  }

  // Backdoor Roth IRA reminder (check if we're in Q4 or early Q1)
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 10 || month === 0) {
    // Nov, Dec, or Jan
    recs.push({
      priority: "medium",
      category: "contribution",
      message:
        "Backdoor Roth IRA contributions due first business day of the new year",
      action:
        "Ensure $7,000 each (Tyler + wife) is ready to contribute to traditional IRA → Roth conversion",
    });
  }

  // Payment due dates approaching
  const today = new Date().getDate();
  for (const d of data.debts.filter((d) => d.status === "active" && d.dueDate)) {
    const daysUntilDue =
      d.dueDate >= today ? d.dueDate - today : d.dueDate + 30 - today;
    if (daysUntilDue <= 5 && daysUntilDue >= 0) {
      recs.push({
        priority: "high",
        category: "payment",
        message: `${d.name} payment of $${d.minPayment.toLocaleString()} due in ${daysUntilDue} day(s) (${d.dueDate}th)`,
        action: "Ensure payment is scheduled or submitted",
      });
    }
  }

  // Low cash warning
  const checkingAccounts = data.accounts.filter(
    (a) => a.accountType === "checking"
  );
  const totalChecking = checkingAccounts.reduce(
    (sum, a) => sum + a.balance,
    0
  );
  if (totalChecking < 5000) {
    recs.push({
      priority: "high",
      category: "cash",
      message: `Checking account balance is low: $${totalChecking.toLocaleString()}`,
      action:
        "Consider transferring from savings or reducing discretionary spending",
    });
  }

  // Contribution optimization
  const pre401k = data.contributions.find(
    (c) => c.contributionType === "pre_tax_401k" && c.isActive
  );
  if (pre401k && pre401k.isPercentage && pre401k.amount < 15) {
    recs.push({
      priority: "low",
      category: "optimization",
      message: `Pre-tax 401k at ${pre401k.amount}% — room to increase toward IRS max ($23,500 in 2026)`,
      action:
        "Evaluate if increasing pre-tax contribution makes sense for tax optimization",
    });
  }

  return recs;
}
