/**
 * Financial OS — Pure calculation functions
 *
 * No database calls. Input → Output. Used by both API routes and client components.
 * Supports multi-person household (tyler/spouse/joint/business) and
 * percentage-based contributions (dynamic with salary changes).
 */

import type {
  FinancialAccount,
  FinancialDebt,
  FinancialIncome,
  FinancialContribution,
  RSUVest,
  NetWorthSummary,
  CashFlowSummary,
  RaiseImpact,
  DebtPayoffProjection,
  ContributionResolved,
  IncomeFrequency,
  Owner,
} from "@/lib/types/finance";

// ── Frequency multipliers (to monthly) ──────────────────────

const FREQ_TO_MONTHLY: Record<IncomeFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  one_time: 0,
};

export function toMonthly(amount: number, frequency: IncomeFrequency): number {
  return amount * FREQ_TO_MONTHLY[frequency];
}

export function toAnnual(amount: number, frequency: IncomeFrequency): number {
  return toMonthly(amount, frequency) * 12;
}

// ── Resolve percentage-based contributions ──────────────────

/**
 * Resolves a contribution to a fixed dollar amount.
 * If is_percentage, calculates against the given salary.
 * Returns resolved per-period, monthly, and annual amounts.
 */
export function resolveContribution(
  c: FinancialContribution,
  annualSalary: number
): ContributionResolved {
  let resolvedAmount: number;

  if (c.isPercentage) {
    // amount is a percentage (e.g., 10 = 10%)
    const annualAmount = (c.amount / 100) * annualSalary;
    // Convert annual to per-period based on frequency
    // FREQ_TO_MONTHLY[freq] * 12 gives periods-per-year (e.g. biweekly → 26/12 * 12 = 26)
    const periodsPerYear = FREQ_TO_MONTHLY[c.frequency] * 12;
    resolvedAmount = periodsPerYear > 0 ? annualAmount / periodsPerYear : annualAmount;
  } else {
    resolvedAmount = c.amount;
  }

  const monthlyAmount = toMonthly(resolvedAmount, c.frequency);
  const annualAmount = monthlyAmount * 12;

  return { contribution: c, resolvedAmount, monthlyAmount, annualAmount };
}

/**
 * Resolves all contributions against a salary, returning total monthly contributions.
 */
export function resolveAllContributions(
  contributions: FinancialContribution[],
  annualSalary: number
): { resolved: ContributionResolved[]; totalMonthly: number; totalAnnual: number } {
  const active = contributions.filter((c) => c.isActive);
  const resolved = active.map((c) => resolveContribution(c, annualSalary));
  const totalMonthly = resolved.reduce((sum, r) => sum + r.monthlyAmount, 0);
  return { resolved, totalMonthly, totalAnnual: totalMonthly * 12 };
}

// ── Net Worth ───────────────────────────────────────────────

export function calculateNetWorth(
  accounts: FinancialAccount[],
  debts: FinancialDebt[],
  rsuVests: RSUVest[]
): NetWorthSummary {
  let totalAssets = 0;
  let cashPosition = 0;
  let investedAssets = 0;
  let retirementAssets = 0;
  let equityAwards = 0;
  let cryptoAssets = 0;
  let tylerAssets = 0;
  let spouseAssets = 0;
  let jointAssets = 0;

  for (const a of accounts) {
    const bal = Number(a.balance);
    totalAssets += bal;

    // By type
    if (a.accountType === "checking" || a.accountType === "savings") cashPosition += bal;
    if (a.accountType === "brokerage") investedAssets += bal;
    if (a.accountType === "401k" || a.accountType === "ira" || a.accountType === "roth_ira") retirementAssets += bal;
    if (a.accountType === "equity_awards") equityAwards += bal;
    if (a.accountType === "crypto") cryptoAssets += bal;

    // By owner
    if (a.owner === "tyler") tylerAssets += bal;
    else if (a.owner === "spouse") spouseAssets += bal;
    else if (a.owner === "joint") jointAssets += bal;
  }

  // Only count vested RSUs toward net worth — unvested shares are not yet owned
  const vestedRSU = rsuVests
    .filter((v) => v.status === "vested")
    .reduce((sum, v) => sum + Number(v.estimatedValue ?? 0), 0);
  equityAwards += vestedRSU;
  for (const v of rsuVests.filter((v) => v.status === "vested")) {
    const val = Number(v.estimatedValue ?? 0);
    if (v.owner === "tyler") tylerAssets += val;
    else if (v.owner === "spouse") spouseAssets += val;
  }

  let totalDebt = 0;
  let creditCardDebt = 0;
  let loanDebt = 0;
  let businessLiabilities = 0;

  for (const d of debts) {
    if (d.status !== "active") continue;
    const bal = Number(d.balance);
    totalDebt += bal;
    if (d.debtType === "credit_card") creditCardDebt += bal;
    else loanDebt += bal;
    if (d.owner === "business") businessLiabilities += bal;
  }

  return {
    totalAssets: totalAssets + vestedRSU,
    totalLiabilities: totalDebt,
    netWorth: totalAssets + vestedRSU - totalDebt,
    cashPosition,
    investedAssets,
    retirementAssets,
    equityAwards,
    cryptoAssets,
    totalDebt,
    creditCardDebt,
    loanDebt,
    tylerAssets,
    spouseAssets,
    jointAssets,
    businessLiabilities,
  };
}

// ── Cash Flow ───────────────────────────────────────────────

export function calculateCashFlow(
  income: FinancialIncome[],
  debts: FinancialDebt[],
  contributions: FinancialContribution[],
  annualSalary: number,
  estimatedMonthlyExpenses: number = 0,
  taxRate: number = 0.30
): CashFlowSummary {
  const activeIncome = income.filter((i) => i.isActive);
  const monthlyGrossIncome = activeIncome.reduce(
    (sum, i) => sum + toMonthly(Number(i.amount), i.frequency),
    0
  );
  const monthlyNetIncome = monthlyGrossIncome * (1 - taxRate);

  const { totalMonthly: monthlyContributions } = resolveAllContributions(contributions, annualSalary);

  // Only count non-credit-card debt for cash flow purposes.
  // Credit card spending is already captured in estimatedMonthlyExpenses
  // since statements are paid in full each month.
  const revolvingDebts = debts.filter(
    (d) => d.status === "active" && d.debtType !== "credit_card"
  );
  const monthlyDebtPayments = revolvingDebts.reduce(
    (sum, d) => sum + Number(d.minPayment),
    0
  );

  const monthlySurplus = monthlyNetIncome - monthlyContributions - monthlyDebtPayments - estimatedMonthlyExpenses;

  return {
    monthlyGrossIncome,
    monthlyNetIncome,
    monthlyContributions,
    monthlyDebtPayments,
    estimatedExpenses: estimatedMonthlyExpenses,
    monthlySurplus,
    annualSurplus: monthlySurplus * 12,
    savingsRate: monthlyNetIncome > 0
      ? ((monthlyContributions + Math.max(0, monthlySurplus)) / monthlyNetIncome) * 100
      : 0,
  };
}

// ── Raise Impact (with dynamic 401k) ────────────────────────

export function calculateRaiseImpact(
  currentSalary: number,
  newSalary: number,
  currentBiweeklyNet: number,
  contributions: FinancialContribution[],
  _taxRate: number = 0.30,
  currentMonthlySurplus: number = 0,
  totalDebt: number = 0
): RaiseImpact {
  void _taxRate;

  const raiseAmount = newSalary - currentSalary;
  const raisePercent = currentSalary > 0 ? (raiseAmount / currentSalary) * 100 : 0;

  const currentBiweeklyGross = currentSalary / 26;
  const newBiweeklyGross = newSalary / 26;

  // Scale net proportionally
  const ratio = currentSalary > 0 ? newSalary / currentSalary : 1;
  const newBiweeklyNet = currentBiweeklyNet * ratio;

  const currentAnnualNet = currentBiweeklyNet * 26;
  const newAnnualNet = newBiweeklyNet * 26;

  const monthlyNetDelta = (newAnnualNet - currentAnnualNet) / 12;

  // 401k impact: resolve percentage-based contributions at both salary levels
  const pctContribs = contributions.filter((c) => c.isPercentage && c.isActive);
  const current401kTotal = pctContribs.reduce(
    (sum, c) => sum + toAnnual((c.amount / 100) * currentSalary / 26, "biweekly"),
    0
  );
  const new401kTotal = pctContribs.reduce(
    (sum, c) => sum + toAnnual((c.amount / 100) * newSalary / 26, "biweekly"),
    0
  );

  const currentEmployerMatch = contributions
    .filter((c) => c.contributionType === "employer_match" && c.isPercentage && c.isActive)
    .reduce((sum, c) => sum + (c.amount / 100) * currentSalary, 0);
  const newEmployerMatch = contributions
    .filter((c) => c.contributionType === "employer_match" && c.isPercentage && c.isActive)
    .reduce((sum, c) => sum + (c.amount / 100) * newSalary, 0);

  // Surplus factors in increased percentage-based contributions
  const contribMonthlyDelta = (new401kTotal - current401kTotal) / 12;
  const newMonthlySurplus = currentMonthlySurplus + monthlyNetDelta - contribMonthlyDelta;

  // Debt payoff
  let debtPayoffMonthsSaved = 0;
  if (totalDebt > 0 && currentMonthlySurplus > 0 && newMonthlySurplus > 0) {
    const currentMonths = totalDebt / currentMonthlySurplus;
    const newMonths = totalDebt / newMonthlySurplus;
    debtPayoffMonthsSaved = Math.max(0, currentMonths - newMonths);
  }

  return {
    currentSalary,
    newSalary,
    raiseAmount,
    raisePercent,
    currentBiweeklyGross,
    newBiweeklyGross,
    currentBiweeklyNet,
    newBiweeklyNet,
    currentAnnualNet,
    newAnnualNet,
    currentMonthlySurplus,
    newMonthlySurplus,
    surplusDelta: newMonthlySurplus - currentMonthlySurplus,
    debtPayoffMonthsSaved,
    current401kTotal,
    new401kTotal,
    delta401k: new401kTotal - current401kTotal,
    currentEmployerMatch,
    newEmployerMatch,
  };
}

// ── Debt Payoff Projection ──────────────────────────────────

export function projectDebtPayoff(
  debt: FinancialDebt,
  monthlyPayment: number
): DebtPayoffProjection {
  const balance = Number(debt.balance);
  const apr = Number(debt.apr);
  const monthlyRate = apr / 100 / 12;

  if (monthlyPayment <= 0 || balance <= 0) {
    return {
      debtName: debt.name,
      currentBalance: balance,
      apr,
      monthlyPayment,
      monthsToPayoff: balance > 0 ? Infinity : 0,
      totalInterestPaid: 0,
      payoffDate: "Never",
    };
  }

  let remaining = balance;
  let months = 0;
  let totalInterest = 0;
  const maxMonths = 600;

  while (remaining > 0.01 && months < maxMonths) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    remaining = remaining + interest - monthlyPayment;
    months++;

    if (remaining > balance * 2) {
      return {
        debtName: debt.name,
        currentBalance: balance,
        apr,
        monthlyPayment,
        monthsToPayoff: Infinity,
        totalInterestPaid: 0,
        payoffDate: "Never (payment < interest)",
      };
    }
  }

  const payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + months);

  return {
    debtName: debt.name,
    currentBalance: balance,
    apr,
    monthlyPayment,
    monthsToPayoff: months,
    totalInterestPaid: Math.round(totalInterest * 100) / 100,
    payoffDate: payoffDate.toISOString().split("T")[0],
  };
}

// ── Owner filtering ─────────────────────────────────────────

export function filterByOwner<T extends { owner: Owner }>(items: T[], owner?: Owner): T[] {
  if (!owner) return items;
  return items.filter((i) => i.owner === owner);
}

// ── Formatting helpers ──────────────────────────────────────

export function formatCurrency(n: number): string {
  if (!isFinite(n)) return "$—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatCurrencyExact(n: number): string {
  if (!isFinite(n)) return "$—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function formatDelta(n: number): string {
  if (!isFinite(n)) return "$—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${formatCurrency(n)}`;
}
