/**
 * Monte Carlo Net Worth Forecast Engine
 *
 * Runs N simulations over M months to project household net worth
 * with confidence bands. Incorporates salary, contributions, RSU vests,
 * portfolio growth (stochastic), expenses, and debt payoff.
 *
 * Pure function — runs client-side, no API calls.
 */

// ── Seeded PRNG (Mulberry32) for reproducibility ───────────────

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform: uniform → standard normal */
function normalRandom(rng: () => number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── Types ──────────────────────────────────────────────────────

export interface ForecastInput {
  // Current balances by asset class
  portfolioValue: number;       // brokerage stocks/ETFs
  cryptoValue: number;
  retirementValue: number;      // 401k + IRAs
  equityAwardsValue: number;    // options/vested RSUs
  cashPosition: number;
  totalDebt: number;

  // Monthly inflows
  monthlyNetIncome: number;     // post-tax household income
  monthlyContributions: number; // 401k + brokerage + crypto + Roth (total)
  monthlyExpenses: number;      // total including rent

  // RSU vests: net of tax
  rsuVests: { monthOffset: number; netValue: number }[];

  // Tunable assumptions
  equityReturnAnnual: number;     // e.g. 0.10 for 10%
  equityVolAnnual: number;        // e.g. 0.156 for 15.6%
  cryptoReturnAnnual: number;     // e.g. 0.18
  cryptoVolAnnual: number;        // e.g. 0.52
  salaryGrowthAnnual: number;     // e.g. 0.04 for 4%
  expenseInflationAnnual: number; // e.g. 0.03 for 3%
}

export interface ForecastResult {
  months: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  labels: string[];   // "Apr 2026", "May 2026", ...
}

// ── Core simulation ────────────────────────────────────────────

export function runNetWorthForecast(
  input: ForecastInput,
  months: number = 60,
  simulations: number = 1000
): ForecastResult {
  const rng = mulberry32(42);

  // Monthly return parameters
  const eqMu = input.equityReturnAnnual / 12;
  const eqSigma = input.equityVolAnnual / Math.sqrt(12);
  const crMu = input.cryptoReturnAnnual / 12;
  const crSigma = input.cryptoVolAnnual / Math.sqrt(12);

  // Monthly growth factors
  const salaryGrowthMonthly = Math.pow(1 + input.salaryGrowthAnnual, 1 / 12) - 1;

  // Build RSU vest lookup: monthOffset → total net value
  const rsuByMonth = new Map<number, number>();
  for (const v of input.rsuVests) {
    rsuByMonth.set(v.monthOffset, (rsuByMonth.get(v.monthOffset) ?? 0) + v.netValue);
  }

  // Run simulations
  const allPaths: number[][] = [];

  for (let sim = 0; sim < simulations; sim++) {
    const path: number[] = new Array(months + 1);

    let portfolio = input.portfolioValue;
    let crypto = input.cryptoValue;
    let retirement = input.retirementValue;
    let equity = input.equityAwardsValue;
    let cash = input.cashPosition;
    let debt = input.totalDebt;
    let monthlyIncome = input.monthlyNetIncome;
    let monthlyExpenses = input.monthlyExpenses;
    let monthlyContribs = input.monthlyContributions;

    // Initial net worth
    path[0] = portfolio + crypto + retirement + equity + cash - debt;

    for (let m = 1; m <= months; m++) {
      // Stochastic returns
      const eqReturn = eqMu + eqSigma * normalRandom(rng);
      const crReturn = crMu + crSigma * normalRandom(rng);

      portfolio *= 1 + eqReturn;
      crypto *= 1 + crReturn;
      retirement *= 1 + eqReturn; // retirement tracks equity
      equity *= 1 + eqReturn * 1.5; // single-stock higher vol

      // Annual salary/expense growth (applied monthly)
      if (m > 0 && m % 12 === 0) {
        monthlyIncome *= 1 + input.salaryGrowthAnnual;
        monthlyExpenses *= 1 + input.expenseInflationAnnual;
        monthlyContribs *= 1 + salaryGrowthMonthly * 12; // contributions scale with salary
      }

      // Monthly surplus → cash (after contributions which go to portfolio/retirement)
      const surplus = monthlyIncome - monthlyExpenses - monthlyContribs;

      // Allocate contributions proportionally
      // ~50% to retirement (401k), ~30% to portfolio (brokerage), ~20% to crypto
      retirement += monthlyContribs * 0.5;
      portfolio += monthlyContribs * 0.3;
      crypto += monthlyContribs * 0.2;

      // Surplus goes to cash (or debt paydown)
      if (debt > 0 && surplus > 0) {
        const debtPayment = Math.min(surplus, debt);
        debt -= debtPayment;
        cash += surplus - debtPayment;
      } else {
        cash += surplus;
      }

      // RSU vest event
      const rsuVest = rsuByMonth.get(m);
      if (rsuVest) {
        portfolio += rsuVest; // vested RSUs add to portfolio value
      }

      path[m] = portfolio + crypto + retirement + equity + cash - debt;
    }

    allPaths.push(path);
  }

  // Compute percentiles at each month
  const result: ForecastResult = {
    months: Array.from({ length: months + 1 }, (_, i) => i),
    p10: [],
    p25: [],
    p50: [],
    p75: [],
    p90: [],
    labels: [],
  };

  const now = new Date();
  for (let m = 0; m <= months; m++) {
    const values = allPaths.map((p) => p[m]).sort((a, b) => a - b);
    result.p10.push(values[Math.floor(simulations * 0.1)]);
    result.p25.push(values[Math.floor(simulations * 0.25)]);
    result.p50.push(values[Math.floor(simulations * 0.5)]);
    result.p75.push(values[Math.floor(simulations * 0.75)]);
    result.p90.push(values[Math.floor(simulations * 0.9)]);

    const labelDate = new Date(now.getFullYear(), now.getMonth() + m, 1);
    result.labels.push(
      labelDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    );
  }

  return result;
}

// ── Helper: convert RSU vest schedule to month offsets ──────────

export function rsuVestsToMonthOffsets(
  vests: Array<{ vestDate: string; estimatedValue: number | null; status: string }>,
  taxRate: number = 0.37
): Array<{ monthOffset: number; netValue: number }> {
  const now = new Date();
  const nowMonth = now.getFullYear() * 12 + now.getMonth();

  return vests
    .filter((v) => v.status === "pending" && v.estimatedValue)
    .map((v) => {
      const vestDate = new Date(v.vestDate);
      const vestMonth = vestDate.getFullYear() * 12 + vestDate.getMonth();
      const monthOffset = vestMonth - nowMonth;
      return {
        monthOffset: Math.max(0, monthOffset),
        netValue: (v.estimatedValue ?? 0) * (1 - taxRate),
      };
    })
    .filter((v) => v.monthOffset >= 0);
}
