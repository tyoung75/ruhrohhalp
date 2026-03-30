import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/finance/seed
 *
 * Seeds the financial database with Tyler's gathered account data.
 * Idempotent — clears existing data first.
 *
 * Data sources:
 *  - Schwab Equity Awards: confirmed via screenshot (CART RSUs + options)
 *  - Fidelity 401(k): confirmed $196,115.91
 *  - E*Trade Brokerage: confirmed $367,441.93 (16 positions + cash)
 *  - E*Trade Roth IRA: confirmed $28,171.42 (8 positions + cash)
 *  - Chase: confirmed checking $11,097.51, savings $2,550.02, 3 credit cards
 *  - Amex: confirmed Platinum $15,045.32, Delta SkyMiles $0, General Ops $127.79
 *  - Wells Fargo: confirmed Reflect $0, Active Cash $0, Platinum $54.42
 *  - Fidelity 401(k): confirmed $196,115.92 — 100% FUIPX (all pre-tax)
 *  - Income, debts, contributions: from Tyler's snapshot + corrections
 */
export async function POST() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const uid = user.id;

  // Clear existing (idempotent)
  await Promise.all([
    supabase.from("financial_alerts").delete().eq("user_id", uid),
    supabase.from("financial_rsu_vests").delete().eq("user_id", uid),
    supabase.from("financial_contributions").delete().eq("user_id", uid),
    supabase.from("financial_holdings").delete().eq("user_id", uid),
    supabase.from("financial_debts").delete().eq("user_id", uid),
    supabase.from("financial_income").delete().eq("user_id", uid),
    supabase.from("financial_config").delete().eq("user_id", uid),
    supabase.from("financial_snapshots").delete().eq("user_id", uid),
  ]);
  await supabase.from("financial_accounts").delete().eq("user_id", uid);

  // ── Accounts ──────────────────────────────────────────────
  const accounts = [
    // Tyler — Chase banking
    { owner: "tyler", account_name: "Total Checking (...6388)", institution: "Chase", account_type: "checking", balance: 11097.51 },
    { owner: "tyler", account_name: "Savings (...5956)", institution: "Chase", account_type: "savings", balance: 2550.02 },
    // Tyler — Investments
    { owner: "tyler", account_name: "Individual Brokerage", institution: "E*Trade", account_type: "brokerage", balance: 367441.93 },
    { owner: "tyler", account_name: "Roth IRA (...9794)", institution: "E*Trade", account_type: "roth_ira", balance: 28171.42 },
{ owner: "tyler", account_name: "Equity Awards (Options)", institution: "Schwab", account_type: "equity_awards", balance: 112211.18 },
    { owner: "tyler", account_name: "401(k)", institution: "Fidelity", account_type: "401k", balance: 196115.92 },
    { owner: "tyler", account_name: "Crypto Portfolio", institution: "Coinbase", account_type: "crypto", balance: 38237.85 },
    // Business — BearDuckHornEmpire LLC
    { owner: "business", account_name: "General Operations (...0616)", institution: "American Express", account_type: "checking", balance: 127.79 },
    // Spouse — confirmed 03/29/2026
    { owner: "spouse", account_name: "Roth IRA (...4281)", institution: "E*Trade", account_type: "roth_ira", balance: 13444.52 },
  ];

  const { data: insertedAccounts } = await supabase
    .from("financial_accounts")
    .insert(accounts.map((a) => ({ ...a, user_id: uid })))
    .select("id, institution, account_type, owner, account_name");

  const findAcct = (inst: string, type: string, own?: string) =>
    insertedAccounts?.find((a) => a.institution === inst && a.account_type === type && (!own || a.owner === own))?.id ?? null;

  // ── Holdings (E*Trade — confirmed positions) ──────────────
  const etradeAcctId = findAcct("E*Trade", "brokerage");
  const etradeHoldings = [
    { symbol: "AAPL", name: "Apple Inc.", shares: 136.296, current_price: 248.80, current_value: 33910.44, cost_basis: 29949.55, holding_type: "stock" },
    { symbol: "AMD", name: "Advanced Micro Devices", shares: 55, current_price: 201.99, current_value: 11109.45, cost_basis: 5449.40, holding_type: "stock" },
    { symbol: "AMZN", name: "Amazon.com", shares: 155, current_price: 199.34, current_value: 30897.70, cost_basis: 34596.54, holding_type: "stock" },
    { symbol: "CART", name: "Maplebear (Instacart)", shares: 2200, current_price: 35.72, current_value: 78584.00, cost_basis: 21010.00, holding_type: "stock" },
    { symbol: "GOOGL", name: "Alphabet Inc.", shares: 281.426, current_price: 274.34, current_value: 77206.41, cost_basis: 53428.78, holding_type: "stock" },
    { symbol: "ITA", name: "iShares U.S. Aerospace & Defense ETF", shares: 20, current_price: 215.95, current_value: 4319.00, cost_basis: 4811.39, holding_type: "etf" },
    { symbol: "META", name: "Meta Platforms", shares: 38.009, current_price: 525.72, current_value: 19982.09, cost_basis: 12145.62, holding_type: "stock" },
    { symbol: "MSFT", name: "Microsoft Corp.", shares: 12.063, current_price: 356.77, current_value: 4303.72, cost_basis: 4756.61, holding_type: "stock" },
    { symbol: "MU", name: "Micron Technology", shares: 49, current_price: 357.22, current_value: 17503.78, cost_basis: 19551.00, holding_type: "stock" },
    { symbol: "NVDA", name: "NVIDIA Corp.", shares: 120.04, current_price: 167.52, current_value: 20109.10, cost_basis: 1507.58, holding_type: "stock" },
    { symbol: "QQQ", name: "Invesco QQQ Trust", shares: 28.084, current_price: 562.58, current_value: 15799.50, cost_basis: 8942.71, holding_type: "etf" },
    { symbol: "RSP", name: "Invesco S&P 500 Equal Weight ETF", shares: 27.562, current_price: 188.46, current_value: 5194.33, cost_basis: 5031.47, holding_type: "etf" },
    { symbol: "SPY", name: "SPDR S&P 500 ETF", shares: 21.267, current_price: 634.18, current_value: 13487.11, cost_basis: 5509.35, holding_type: "etf" },
    { symbol: "UBER", name: "Uber Technologies", shares: 95, current_price: 69.18, current_value: 6572.10, cost_basis: 6216.51, holding_type: "stock" },
    { symbol: "VO", name: "Vanguard Mid-Cap ETF", shares: 39.629, current_price: 282.77, current_value: 11205.89, cost_basis: 4845.12, holding_type: "etf" },
    { symbol: "XAR", name: "SPDR S&P Aerospace & Defense ETF", shares: 17, current_price: 250.73, current_value: 4262.41, cost_basis: 4750.99, holding_type: "etf" },
  ];

  if (etradeAcctId) {
    await supabase.from("financial_holdings").insert(
      etradeHoldings.map((h) => ({ ...h, user_id: uid, account_id: etradeAcctId }))
    );
  }

  // ── Holdings (E*Trade Roth IRA — confirmed positions) ──────
  const etradeIraId = findAcct("E*Trade", "roth_ira", "tyler");
  const etradeIraHoldings = [
    { symbol: "AAPL", name: "Apple Inc.", shares: 10, current_price: 248.80, current_value: 2488.00, cost_basis: 2729.50, holding_type: "stock" },
    { symbol: "AVUV", name: "Avantis U.S. Small Cap Value ETF", shares: 12, current_price: 109.22, current_value: 1310.64, cost_basis: 1358.58, holding_type: "etf" },
    { symbol: "IBIT", name: "iShares Bitcoin Trust ETF", shares: 132, current_price: 37.40, current_value: 4936.80, cost_basis: 4930.05, holding_type: "etf" },
    { symbol: "NUKZ", name: "Range Nuclear Renaissance Index ETF", shares: 30, current_price: 65.04, current_value: 1951.20, cost_basis: 2140.22, holding_type: "etf" },
    { symbol: "QQQ", name: "Invesco QQQ Trust", shares: 11, current_price: 562.58, current_value: 6188.38, cost_basis: 6585.87, holding_type: "etf" },
    { symbol: "SPY", name: "SPDR S&P 500 ETF", shares: 3, current_price: 634.18, current_value: 1902.54, cost_basis: 2067.90, holding_type: "etf" },
    { symbol: "VTI", name: "Vanguard Total Stock Market ETF", shares: 22, current_price: 313.04, current_value: 6886.88, cost_basis: 7444.79, holding_type: "etf" },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", shares: 33, current_price: 74.69, current_value: 2464.77, cost_basis: 2646.17, holding_type: "etf" },
    { symbol: "CASH", name: "Cash", shares: 1, current_price: 42.21, current_value: 42.21, cost_basis: 42.21, holding_type: "cash" },
  ];

  if (etradeIraId) {
    await supabase.from("financial_holdings").insert(
      etradeIraHoldings.map((h) => ({ ...h, user_id: uid, account_id: etradeIraId }))
    );
  }

  // ── Holdings (Wife's E*Trade Roth IRA) ─────────────────────
  const spouseIraId = findAcct("E*Trade", "roth_ira", "spouse");
  // Positions TBD — only have total $13,444.52 and $53.53 cash for now
  if (spouseIraId) {
    await supabase.from("financial_holdings").insert([
      { symbol: "CASH", name: "Cash", shares: 1, current_price: 53.53, current_value: 53.53, cost_basis: 53.53, holding_type: "cash", user_id: uid, account_id: spouseIraId },
    ]);
  }

  // ── Holdings (Fidelity 401k — all pre-tax) ──────────────────
  const fidelityAcctId = findAcct("Fidelity", "401k");
  const fidelityHoldings = [
    { symbol: "FUIPX", name: "Fidelity Freedom Index 2060 Premier", shares: 9474.199, current_price: 20.70, current_value: 196115.92, cost_basis: 153337.24, holding_type: "mutual_fund", notes: "All pre-tax 401(k)" },
  ];

  if (fidelityAcctId) {
    await supabase.from("financial_holdings").insert(
      fidelityHoldings.map((h) => ({ ...h, user_id: uid, account_id: fidelityAcctId }))
    );
  }

  // ── Holdings (Coinbase — confirmed 03/29/2026) ──────────────
  const coinbaseAcctId = findAcct("Coinbase", "crypto");
  const coinbaseHoldings = [
    { symbol: "BTC", name: "Bitcoin", shares: 0.266451, current_price: 66650, current_value: 17755.42, cost_basis: 0, holding_type: "crypto", notes: "0.266451 BTC" },
    { symbol: "ETH", name: "Ethereum", shares: 7.63, current_price: 2004, current_value: 15286.93, cost_basis: 0, holding_type: "crypto", notes: "7.63 ETH — 99% staked, rewards are % of holdings" },
    { symbol: "XRP", name: "XRP", shares: 2294.41, current_price: 1.3243, current_value: 3038.60, cost_basis: 0, holding_type: "crypto" },
    { symbol: "SOL", name: "Solana", shares: 26.32, current_price: 81.95, current_value: 2156.89, cost_basis: 0, holding_type: "crypto", notes: "26.32 SOL — 100% staked, rewards are % of holdings" },
  ];

  if (coinbaseAcctId) {
    await supabase.from("financial_holdings").insert(
      coinbaseHoldings.map((h) => ({ ...h, user_id: uid, account_id: coinbaseAcctId }))
    );
  }

  // ── Income Sources ────────────────────────────────────────
  const income = [
    { owner: "tyler", source: "salary", label: "Base Salary (Instacart)", amount: 232800, frequency: "annual", is_active: true },
    { owner: "spouse", source: "salary", label: "Wife's Salary (Dexian LLC)", amount: 142576.75, frequency: "annual", is_active: true },
  ];

  await supabase.from("financial_income").insert(income.map((i) => ({ ...i, user_id: uid })));

  // ── Debts ─────────────────────────────────────────────────
  const debts = [
    // Chase credit cards — confirmed 03/29/2026
    { owner: "tyler", name: "Sapphire Reserve (...5474)", institution: "Chase", balance: 2104.54, apr: 21.49, min_payment: 136.37, debt_type: "credit_card", status: "active" },
    { owner: "tyler", name: "Instacart Mastercard (...1419)", institution: "Chase", balance: 0, apr: 20.99, min_payment: 0, debt_type: "credit_card", status: "active" },
    { owner: "tyler", name: "Amazon Prime (...0820)", institution: "Chase", balance: 2800.63, apr: 20.99, min_payment: 35, debt_type: "credit_card", status: "active" },
    // Amex — confirmed 03/29/2026
    { owner: "tyler", name: "Amex Platinum (...91003)", institution: "American Express", balance: 15045.32, apr: 22.99, min_payment: 500, debt_type: "credit_card", status: "active" },
    { owner: "tyler", name: "Delta SkyMiles Platinum (...21009)", institution: "American Express", balance: 0, apr: 20.99, min_payment: 0, debt_type: "credit_card", status: "active" },
    // Wells Fargo — confirmed 03/29/2026
    { owner: "tyler", name: "Reflect Visa (...2469)", institution: "Wells Fargo", balance: 0, apr: 20.99, min_payment: 0, debt_type: "credit_card", status: "active" },
    { owner: "tyler", name: "Active Cash Visa (...8224)", institution: "Wells Fargo", balance: 0, apr: 20.99, min_payment: 0, debt_type: "credit_card", status: "active" },
    { owner: "tyler", name: "Platinum Card (...7901)", institution: "Wells Fargo", balance: 54.42, apr: 20.99, min_payment: 0, debt_type: "credit_card", status: "active" },
    // Business — BEARDUCKHORNEMPIRE LLC, confirmed 03/29/2026
    { owner: "business", name: "Ink Preferred (...8707)", institution: "Chase", balance: 185.57, apr: 18.99, min_payment: 40, debt_type: "credit_card", status: "active", notes: "BDHE LLC — auto-pay scheduled, statement closing alert active" },
  ];

  await supabase.from("financial_debts").insert(debts.map((d) => ({ ...d, user_id: uid })));

  // ── Contributions (with percentage-based 401k) ────────────
  const contributions = [
    // E*Trade brokerage
    { owner: "tyler", destination: "E*Trade Brokerage", account_id: etradeAcctId, amount: 1000, is_percentage: false, frequency: "biweekly", contribution_type: "investment", is_active: true },
    // 401(k) — percentage-based, dynamic with salary
    { owner: "tyler", destination: "Fidelity 401(k) Pre-Tax", account_id: findAcct("Fidelity", "401k"), amount: 10, is_percentage: true, frequency: "biweekly", contribution_type: "pre_tax_401k", is_active: true, notes: "10% of salary pre-tax" },
    { owner: "tyler", destination: "Fidelity 401(k) After-Tax (Mega Backdoor)", account_id: findAcct("Fidelity", "401k"), amount: 15, is_percentage: true, frequency: "biweekly", contribution_type: "after_tax_401k", is_active: true, notes: "15% after-tax for mega backdoor Roth conversion" },
    { owner: "tyler", destination: "Instacart 401(k) Employer Match", account_id: findAcct("Fidelity", "401k"), amount: 4, is_percentage: true, frequency: "biweekly", contribution_type: "employer_match", is_active: true, notes: "4% employer match" },
    // Backdoor Roth IRA — both Tyler & wife, maxed 2025+2026, first biz day of year going forward
    { owner: "tyler", destination: "E*Trade Roth IRA (Backdoor)", account_id: etradeIraId, amount: 7000, is_percentage: false, frequency: "annual", contribution_type: "roth_ira", is_active: true, notes: "Backdoor Roth — maxed 2025 & 2026, first biz day of each year" },
    { owner: "spouse", destination: "E*Trade Roth IRA (Backdoor)", account_id: spouseIraId, amount: 7000, is_percentage: false, frequency: "annual", contribution_type: "roth_ira", is_active: true, notes: "Wife's backdoor Roth — maxed 2025 & 2026, first biz day of each year" },
    // Coinbase crypto — confirmed: monthly on the 4th, $500/mo total
    { owner: "tyler", destination: "Coinbase BTC", account_id: findAcct("Coinbase", "crypto"), amount: 200, is_percentage: false, frequency: "monthly", contribution_type: "crypto", is_active: true, day_of_month: 4, notes: "$200/mo on the 4th — Bitcoin" },
    { owner: "tyler", destination: "Coinbase ETH", account_id: findAcct("Coinbase", "crypto"), amount: 200, is_percentage: false, frequency: "monthly", contribution_type: "crypto", is_active: true, day_of_month: 4, notes: "$200/mo on the 4th — Ethereum" },
    { owner: "tyler", destination: "Coinbase XRP", account_id: findAcct("Coinbase", "crypto"), amount: 50, is_percentage: false, frequency: "monthly", contribution_type: "crypto", is_active: true, day_of_month: 4, notes: "$50/mo on the 4th — XRP" },
    { owner: "tyler", destination: "Coinbase SOL", account_id: findAcct("Coinbase", "crypto"), amount: 50, is_percentage: false, frequency: "monthly", contribution_type: "crypto", is_active: true, day_of_month: 4, notes: "$50/mo on the 4th — Solana" },
  ];

  await supabase.from("financial_contributions").insert(contributions.map((c) => ({ ...c, user_id: uid })));

  // ── RSU Vests (CART @ $35.21) ─────────────────────────────
  const CART_PRICE = 35.21;
  const rsuVests = [
    // May 2026
    { owner: "tyler", symbol: "CART", shares: 279, vest_date: "2026-05-15", grant_id: "201814056", award_date: "2023-03-14", current_price: CART_PRICE, estimated_value: 9823.59, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 254, vest_date: "2026-05-15", grant_id: "201830785", award_date: "2025-04-16", current_price: CART_PRICE, estimated_value: 8943.34, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 207, vest_date: "2026-05-15", grant_id: "201829894", award_date: "2025-04-16", current_price: CART_PRICE, estimated_value: 7288.47, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 413, vest_date: "2026-05-15", grant_id: "201827694", award_date: "2024-10-15", current_price: CART_PRICE, estimated_value: 14541.73, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 68, vest_date: "2026-05-15", grant_id: "201810938", award_date: "2022-04-16", current_price: CART_PRICE, estimated_value: 2394.28, status: "pending" },
    // August 2026
    { owner: "tyler", symbol: "CART", shares: 280, vest_date: "2026-08-15", grant_id: "201814056", award_date: "2023-03-14", current_price: CART_PRICE, estimated_value: 9858.80, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 206, vest_date: "2026-08-15", grant_id: "201829894", award_date: "2025-04-16", current_price: CART_PRICE, estimated_value: 7253.26, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 414, vest_date: "2026-08-15", grant_id: "201827694", award_date: "2024-10-15", current_price: CART_PRICE, estimated_value: 14576.94, status: "pending" },
    // November 2026
    { owner: "tyler", symbol: "CART", shares: 280, vest_date: "2026-11-15", grant_id: "201814056", award_date: "2023-03-14", current_price: CART_PRICE, estimated_value: 9858.80, status: "pending" },
    { owner: "tyler", symbol: "CART", shares: 207, vest_date: "2026-11-15", grant_id: "201829894", award_date: "2025-04-16", current_price: CART_PRICE, estimated_value: 7288.47, status: "pending" },
    // February 2027
    { owner: "tyler", symbol: "CART", shares: 206, vest_date: "2027-02-15", grant_id: "201829894", award_date: "2025-04-16", current_price: CART_PRICE, estimated_value: 7253.26, status: "pending" },
  ];

  await supabase.from("financial_rsu_vests").insert(rsuVests.map((r) => ({ ...r, user_id: uid })));

  // ── Alerts ────────────────────────────────────────────────
  // Business Chase CC statement closing alert
  const bizDebtId = (await supabase.from("financial_debts").select("id").eq("user_id", uid).eq("owner", "business").single())?.data?.id;
  if (bizDebtId) {
    await supabase.from("financial_alerts").insert({
      user_id: uid,
      debt_id: bizDebtId,
      alert_type: "statement_closing",
      rule: { trigger: "email_subject", pattern: "statement is ready|statement closing|statement balance", sender_pattern: "chase.com" },
      message: "Chase Business CC statement closing — update balance",
      is_active: true,
    });
  }

  // ── Config ────────────────────────────────────────────────
  const config = [
    { key: "tax_rate", value: "0.30" },
    { key: "monthly_expenses", value: "12000" },
    { key: "biweekly_net", value: "5217.81" },
    { key: "annual_salary", value: "232800" },
    { key: "cart_stock_price", value: String(CART_PRICE) },
    { key: "pretax_401k_pct", value: "10" },
    { key: "aftertax_401k_pct", value: "15" },
    { key: "employer_match_pct", value: "4" },
    // Staking reward APYs — rewards are % of staked holdings, not fixed amounts
    { key: "eth_staking_apy", value: "2.4" },
    { key: "sol_staking_apy", value: "5.5" },
  ];

  await supabase.from("financial_config").insert(config.map((c) => ({ ...c, user_id: uid })));

  return NextResponse.json({
    seeded: true,
    counts: {
      accounts: accounts.length,
      holdings: etradeHoldings.length + etradeIraHoldings.length + fidelityHoldings.length + coinbaseHoldings.length,
      income: income.length,
      debts: debts.length,
      contributions: contributions.length,
      rsuVests: rsuVests.length,
      config: config.length,
    },
  });
}
