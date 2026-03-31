/**
 * Financial OS type definitions
 * Multi-person household: tyler | spouse | joint | business
 */

export type Owner = "tyler" | "spouse" | "joint" | "business";
export type AccountType = "checking" | "savings" | "brokerage" | "401k" | "ira" | "roth_ira" | "equity_awards" | "crypto" | "other";
export type HoldingType = "stock" | "etf" | "mutual_fund" | "option" | "crypto" | "cash" | "bond" | "other";
export type IncomeFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual" | "one_time";
export type DebtType = "credit_card" | "personal_loan" | "auto_loan" | "mortgage" | "student_loan" | "margin_loan" | "line_of_credit" | "other";
export type DebtStatus = "active" | "paid_off" | "closed";
export type VestStatus = "pending" | "vested" | "sold";
export type ContributionType = "pre_tax_401k" | "after_tax_401k" | "employer_match" | "roth_ira" | "investment" | "crypto" | "other";
export type AlertType = "statement_closing" | "balance_threshold" | "payment_due" | "vest_approaching" | "custom";

export interface FinancialAccount {
  id: string;
  userId: string;
  owner: Owner;
  accountName: string;
  institution: string;
  accountType: AccountType;
  balance: number;
  currency: string;
  notes: string | null;
  lastSynced: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialHolding {
  id: string;
  accountId: string;
  userId: string;
  symbol: string;
  name: string | null;
  shares: number;
  currentPrice: number | null;
  currentValue: number;
  costBasis: number | null;
  holdingType: HoldingType;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialIncome {
  id: string;
  userId: string;
  owner: Owner;
  source: string;
  label: string;
  amount: number;
  frequency: IncomeFrequency;
  isActive: boolean;
  effectiveDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialDebt {
  id: string;
  userId: string;
  owner: Owner;
  name: string;
  institution: string;
  balance: number;
  creditLimit: number | null;
  apr: number;
  minPayment: number;
  debtType: DebtType;
  status: DebtStatus;
  dueDate: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialContribution {
  id: string;
  userId: string;
  owner: Owner;
  destination: string;
  accountId: string | null;
  amount: number;
  isPercentage: boolean;
  frequency: IncomeFrequency;
  contributionType: ContributionType;
  isActive: boolean;
  dayOfMonth: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RSUVest {
  id: string;
  userId: string;
  owner: Owner;
  symbol: string;
  shares: number;
  vestDate: string;
  grantId: string | null;
  awardDate: string | null;
  currentPrice: number | null;
  estimatedValue: number | null;
  status: VestStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialAlert {
  id: string;
  userId: string;
  debtId: string | null;
  accountId: string | null;
  alertType: AlertType;
  rule: Record<string, unknown>;
  message: string | null;
  isActive: boolean;
  lastTriggered: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialSnapshot {
  id: string;
  userId: string;
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  cashPosition: number;
  breakdown: Record<string, number>;
  createdAt: string;
}

// ── Computed / derived types ────────────────────────────────

export interface NetWorthSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  cashPosition: number;
  investedAssets: number;
  retirementAssets: number;
  equityAwards: number;
  cryptoAssets: number;
  totalDebt: number;
  creditCardDebt: number;
  loanDebt: number;
  // Per-owner breakdown
  tylerAssets: number;
  spouseAssets: number;
  jointAssets: number;
  businessLiabilities: number;
}

export interface CashFlowSummary {
  monthlyGrossIncome: number;
  monthlyNetIncome: number;
  monthlyContributions: number;
  monthlyDebtPayments: number;
  estimatedExpenses: number;
  monthlySurplus: number;
  annualSurplus: number;
  savingsRate: number;
}

export interface ContributionResolved {
  /** The contribution record */
  contribution: FinancialContribution;
  /** Resolved dollar amount per pay period (percentage × salary if is_percentage) */
  resolvedAmount: number;
  /** Monthly equivalent */
  monthlyAmount: number;
  /** Annual equivalent */
  annualAmount: number;
}

export interface RaiseImpact {
  currentSalary: number;
  newSalary: number;
  raiseAmount: number;
  raisePercent: number;
  currentBiweeklyGross: number;
  newBiweeklyGross: number;
  currentBiweeklyNet: number;
  newBiweeklyNet: number;
  currentAnnualNet: number;
  newAnnualNet: number;
  currentMonthlySurplus: number;
  newMonthlySurplus: number;
  surplusDelta: number;
  debtPayoffMonthsSaved: number;
  // Dynamic 401k impact
  current401kTotal: number;
  new401kTotal: number;
  delta401k: number;
  currentEmployerMatch: number;
  newEmployerMatch: number;
}

export interface DebtPayoffProjection {
  debtName: string;
  currentBalance: number;
  apr: number;
  monthlyPayment: number;
  monthsToPayoff: number;
  totalInterestPaid: number;
  payoffDate: string;
}

// ── Performance metrics ────────────────────────────────────

export interface HoldingPerformance {
  symbol: string;
  dailyChange: number;
  dailyChangePct: number;
  weekChange: number;
  weekChangePct: number;
  monthChange: number;
  monthChangePct: number;
  ytdChange: number;
  ytdChangePct: number;
  yearChange: number;
  yearChangePct: number;
  totalReturn: number;
  totalReturnPct: number;
}

export interface PortfolioPerformance {
  dailyChange: number;
  dailyChangePct: number;
  weekChange: number;
  weekChangePct: number;
  monthChange: number;
  monthChangePct: number;
  ytdChange: number;
  ytdChangePct: number;
  yearChange: number;
  yearChangePct: number;
  totalReturn: number;
  totalReturnPct: number;
}

export interface HistoricalPrices {
  symbol: string;
  price1dAgo: number | null;
  price1wAgo: number | null;
  price1mAgo: number | null;
  priceYtdStart: number | null;
  price1yAgo: number | null;
}

export interface FinancialDashboardData {
  accounts: FinancialAccount[];
  holdings: FinancialHolding[];
  income: FinancialIncome[];
  debts: FinancialDebt[];
  contributions: FinancialContribution[];
  rsuVests: RSUVest[];
  alerts: FinancialAlert[];
  snapshots: FinancialSnapshot[];
  summary: NetWorthSummary;
  cashFlow: CashFlowSummary;
  config: Record<string, string>;
}
