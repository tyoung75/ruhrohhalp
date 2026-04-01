/**
 * Monte Carlo Net Worth Forecast Engine
 *
 * Runs N simulations over M months to project household net worth
 * with confidence bands. Models each account bucket separately with
 * its own return profile and contribution stream:
 *
 *   Brokerage (E*Trade)    → SPY/QQQ blend (large-cap growth)
 *   Roth IRA (Tyler)       → Higher-risk growth ETFs (AVUV, VTI, IBIT, etc.)
 *   Roth IRA (Spouse)      → Similar growth allocation
 *   401k + Mega Backdoor   → FUIPX (Fidelity Freedom Index 2060, ~90/10 equity/bond)
 *   Crypto (Coinbase)      → BTC/ETH/altcoin blend
 *   Equity Awards (Schwab) → CART single-stock risk
 *   Cash (Chase)           → Negligible return
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

// ── Asset class return profiles ────────────────────────────────
// Based on historical performance and fund characteristics

export interface AssetClassParams {
  returnAnnual: number;   // expected annual return
  volAnnual: number;      // annual volatility (std dev)
  label: string;
}

/** Default return profiles for each account bucket */
export const ASSET_CLASS_DEFAULTS = {
  // SPY/QQQ blend — S&P 500 + Nasdaq-100 mix (~60/40 SPY/QQQ)
  // Historical: SPY ~10.5%, QQQ ~14%, blended ~12%, vol ~17%
  brokerage: { returnAnnual: 0.12, volAnnual: 0.17, label: "Brokerage (SPY/QQQ)" },

  // Growth ETFs — AVUV (small cap value), VTI (total market), IBIT (bitcoin ETF),
  // VXUS (international) — higher risk, higher expected return
  // Small cap value has historically outperformed by 2-3%
  rothIra: { returnAnnual: 0.13, volAnnual: 0.20, label: "Roth IRA (Growth ETFs)" },

  // FUIPX — Fidelity Freedom Index 2060 Premier
  // ~90% equity / 10% bonds, 0.12% expense ratio
  // Historical 5yr: ~10-12% annualized, vol ~15%
  retirement: { returnAnnual: 0.10, volAnnual: 0.15, label: "401k/MBDR (FUIPX)" },

  // BTC/ETH/altcoin blend — highly volatile, higher expected return
  crypto: { returnAnnual: 0.18, volAnnual: 0.52, label: "Crypto (BTC/ETH/SOL)" },

  // CART single stock — higher single-stock volatility
  equityAwards: { returnAnnual: 0.10, volAnnual: 0.35, label: "Equity Awards (CART)" },

  // Cash — ~4.5% APY savings / money market (conservative)
  cash: { returnAnnual: 0.04, volAnnual: 0.005, label: "Cash" },
} as const;

// ── Types ──────────────────────────────────────────────────────

export interface ForecastInput {
  // Current balances by account bucket
  brokerageValue: number;       // E*Trade brokerage
  rothIraValue: number;         // Tyler + spouse Roth IRAs
  retirementValue: number;      // Fidelity 401k (pre-tax + mega backdoor Roth)
  cryptoValue: number;          // Coinbase
  equityAwardsValue: number;    // Schwab equity awards
  cashPosition: number;         // Chase checking/savings
  totalDebt: number;

  // Monthly contribution breakdown (actual allocation)
  monthlyBrokerageContrib: number;     // $1,000 biweekly = ~$2,167/mo to SPY/QQQ
  monthlyRetirementContrib: number;    // 10% pre-tax + 15% after-tax + 4% match → FUIPX
  monthlyRothIraContrib: number;       // $7K/yr each = ~$1,167/mo (Tyler + spouse)
  monthlyCryptoContrib: number;        // $500/mo (BTC/ETH/XRP/SOL DCA)

  // Income and expenses
  monthlyNetIncome: number;
  monthlyExpenses: number;

  // RSU vests: net of tax → goes to brokerage bucket
  rsuVests: { monthOffset: number; netValue: number }[];

  // Tunable return assumptions per asset class
  brokerageReturn: AssetClassParams;
  rothIraReturn: AssetClassParams;
  retirementReturn: AssetClassParams;
  cryptoReturn: AssetClassParams;
  equityAwardsReturn: AssetClassParams;

  // Growth rates
  salaryGrowthAnnual: number;
  expenseInflationAnnual: number;
}

export interface ForecastResult {
  months: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  labels: string[];
}

// ── Core simulation ────────────────────────────────────────────

export function runNetWorthForecast(
  input: ForecastInput,
  months: number = 60,
  simulations: number = 1000
): ForecastResult {
  const rng = mulberry32(42);

  // Monthly return parameters for each bucket
  const brokerageMu = input.brokerageReturn.returnAnnual / 12;
  const brokerageSigma = input.brokerageReturn.volAnnual / Math.sqrt(12);
  const rothMu = input.rothIraReturn.returnAnnual / 12;
  const rothSigma = input.rothIraReturn.volAnnual / Math.sqrt(12);
  const retMu = input.retirementReturn.returnAnnual / 12;
  const retSigma = input.retirementReturn.volAnnual / Math.sqrt(12);
  const crMu = input.cryptoReturn.returnAnnual / 12;
  const crSigma = input.cryptoReturn.volAnnual / Math.sqrt(12);
  const eqMu = input.equityAwardsReturn.returnAnnual / 12;
  const eqSigma = input.equityAwardsReturn.volAnnual / Math.sqrt(12);

  // Build RSU vest lookup
  const rsuByMonth = new Map<number, number>();
  for (const v of input.rsuVests) {
    rsuByMonth.set(v.monthOffset, (rsuByMonth.get(v.monthOffset) ?? 0) + v.netValue);
  }

  const allPaths: number[][] = [];

  for (let sim = 0; sim < simulations; sim++) {
    const path: number[] = new Array(months + 1);

    let brokerage = input.brokerageValue;
    let rothIra = input.rothIraValue;
    let retirement = input.retirementValue;
    let crypto = input.cryptoValue;
    let equityAwards = input.equityAwardsValue;
    let cash = input.cashPosition;
    let debt = input.totalDebt;

    let monthlyIncome = input.monthlyNetIncome;
    let monthlyExpenses = input.monthlyExpenses;
    let brokerageContrib = input.monthlyBrokerageContrib;
    let retirementContrib = input.monthlyRetirementContrib;
    const rothContrib = input.monthlyRothIraContrib;
    const cryptoContrib = input.monthlyCryptoContrib;

    path[0] = brokerage + rothIra + retirement + crypto + equityAwards + cash - debt;

    for (let m = 1; m <= months; m++) {
      // Each bucket gets its own stochastic return (partially correlated via equity market)
      // Use separate random draws — they'll have natural correlation through market beta
      const brokerageReturn = brokerageMu + brokerageSigma * normalRandom(rng);
      const rothReturn = rothMu + rothSigma * normalRandom(rng);
      const retReturn = retMu + retSigma * normalRandom(rng);
      const crReturn = crMu + crSigma * normalRandom(rng);
      const eqReturn = eqMu + eqSigma * normalRandom(rng);

      // Apply returns to existing balances
      brokerage *= 1 + brokerageReturn;
      rothIra *= 1 + rothReturn;
      retirement *= 1 + retReturn;
      crypto *= 1 + crReturn;
      equityAwards *= 1 + eqReturn;
      // Cash earns savings rate (~4% annually, negligible vol)
      cash *= 1 + 0.04 / 12;

      // Annual salary/expense growth
      if (m % 12 === 0) {
        monthlyIncome *= 1 + input.salaryGrowthAnnual;
        monthlyExpenses *= 1 + input.expenseInflationAnnual;
        // Contributions scale with salary (401k is percentage-based)
        brokerageContrib *= 1 + input.salaryGrowthAnnual;
        retirementContrib *= 1 + input.salaryGrowthAnnual;
      }

      // Route contributions to their specific accounts
      brokerage += brokerageContrib;        // → SPY/QQQ
      retirement += retirementContrib;      // → FUIPX
      rothIra += rothContrib;               // → Growth ETFs (AVUV, VTI, IBIT, VXUS)
      crypto += cryptoContrib;              // → BTC/ETH/XRP/SOL

      // Monthly surplus after contributions and expenses
      const currentContribs = brokerageContrib + retirementContrib + rothContrib + cryptoContrib;
      const surplus = monthlyIncome - monthlyExpenses - currentContribs;

      // Surplus: pay down debt first, then excess to cash
      if (debt > 0 && surplus > 0) {
        const debtPayment = Math.min(surplus, debt);
        debt -= debtPayment;
        cash += surplus - debtPayment;
      } else {
        cash += surplus;
      }

      // RSU vest events → add to brokerage (sold and reinvested in SPY/QQQ)
      const rsuVest = rsuByMonth.get(m);
      if (rsuVest) {
        brokerage += rsuVest;
      }

      path[m] = brokerage + rothIra + retirement + crypto + equityAwards + cash - debt;
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
