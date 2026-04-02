"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import {
  formatCurrency,
  formatDelta,
  formatPercent,
  calculateRaiseImpact,
  calculateHoldingPerformance,
  calculatePortfolioPerformance,
  resolveAllContributions,
  projectDebtPayoff,
  adjustNetWorthWithQuotes,
} from "@/lib/finance";
import type {
  FinancialDashboardData,
  Owner,
  RaiseImpact,
  FinancialAccount,
  FinancialHolding,
  HistoricalPrices,
} from "@/lib/types/finance";
import type { StockQuote } from "@/app/api/finance/quotes/route";
import type { HistoricalPriceData } from "@/app/api/finance/quotes/historical/route";
import { runNetWorthForecast, rsuVestsToMonthOffsets, ASSET_CLASS_DEFAULTS } from "@/lib/forecast";
import type { ForecastInput, AssetClassParams } from "@/lib/forecast";
import { Spinner } from "@/components/primitives";
import { WealthAdvisorSection } from "@/components/finance/WealthAdvisorSection";
import { useMobile } from "@/lib/useMobile";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// REAL-TIME STOCK QUOTES HOOK
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000; // 30 seconds

interface QuotesState {
  quotes: Record<string, StockQuote>;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  marketState: string | null;
}

function useStockQuotes(symbols: string[]) {
  const [state, setState] = useState<QuotesState>({
    quotes: {},
    loading: false,
    error: null,
    fetchedAt: null,
    marketState: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuotes = useCallback(async () => {
    if (symbols.length === 0) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const uniqueSymbols = [...new Set(symbols)].filter(Boolean);
      const res = await api<{ quotes: StockQuote[]; fetchedAt: string }>(
        `/api/finance/quotes?symbols=${uniqueSymbols.join(",")}`
      );
      const quotesMap: Record<string, StockQuote> = {};
      for (const q of res.quotes) {
        quotesMap[q.symbol] = q;
      }
      const firstQuote = res.quotes[0];
      setState({
        quotes: quotesMap,
        loading: false,
        error: null,
        fetchedAt: res.fetchedAt,
        marketState: firstQuote?.marketState ?? null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch quotes",
      }));
    }
  }, [symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchQuotes();
    intervalRef.current = setInterval(fetchQuotes, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQuotes]);

  return { ...state, refetch: fetchQuotes };
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORICAL QUOTES HOOK (for performance metrics)
// ─────────────────────────────────────────────────────────────────────────────

const HISTORICAL_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function useHistoricalQuotes(symbols: string[]) {
  const [data, setData] = useState<Record<string, HistoricalPrices>>({});
  const [loading, setLoading] = useState(false);

  const fetchHistorical = useCallback(async () => {
    const filteredSymbols = symbols.filter((s) => s !== "CASH" && s !== "FUIPX");
    if (filteredSymbols.length === 0) return;

    setLoading(true);
    try {
      const res = await api<{ historical: Record<string, HistoricalPriceData> }>(
        `/api/finance/quotes/historical?symbols=${filteredSymbols.join(",")}`
      );
      // Map to HistoricalPrices type
      const mapped: Record<string, HistoricalPrices> = {};
      for (const [sym, d] of Object.entries(res.historical)) {
        mapped[sym] = {
          symbol: d.symbol,
          price1dAgo: d.price1dAgo,
          price1wAgo: d.price1wAgo,
          price1mAgo: d.price1mAgo,
          priceYtdStart: d.priceYtdStart,
          price1yAgo: d.price1yAgo,
        };
      }
      setData(mapped);
    } catch (err) {
      console.warn("Failed to fetch historical quotes:", err);
    } finally {
      setLoading(false);
    }
  }, [symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchHistorical();
    const interval = setInterval(fetchHistorical, HISTORICAL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchHistorical]);

  return { historical: data, historicalLoading: loading };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_GROUPS = {
  Cash: ["checking", "savings"],
  Investments: ["brokerage"],
  Retirement: ["401k", "ira", "roth_ira"],
  Equity: ["equity_awards"],
  Crypto: ["crypto"],
} as const;

const OWNER_COLORS: Record<Owner, { bg: string; text: string; label: string }> = {
  tyler: { bg: "#5d9ef8", text: "#ffffff", label: "Tyler" },
  spouse: { bg: "#c77ddb", text: "#ffffff", label: "Wife" },
  joint: { bg: "#6fcf9a", text: "#ffffff", label: "Joint" },
  business: { bg: "#f4c842", text: "#1a1d27", label: "Business" },
};

const DEBT_TYPE_COLORS: Record<string, string> = {
  credit_card: "#ef7f7f",
  margin_loan: "#f4a623",
  personal_loan: "#6fcf9a",
  auto_loan: "#5d9ef8",
  mortgage: "#9ec8f5",
  student_loan: "#c77ddb",
  line_of_credit: "#e07d4a",
  other: C.textDim,
};

// ─────────────────────────────────────────────────────────────────────────────
// SPINNER / LOADING STATE
// ─────────────────────────────────────────────────────────────────────────────

function LoadingPage() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <Spinner color={C.gold} size={24} />
      <div style={{ marginTop: 16, color: C.textDim, fontFamily: C.sans }}>
        Loading financial dashboard...
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Badge({
  color,
  label,
  style: customStyle,
}: {
  color: string;
  label: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontFamily: C.mono,
        letterSpacing: 0.5,
        padding: "2px 8px",
        borderRadius: 4,
        background: `${color}20`,
        color,
        border: `1px solid ${color}40`,
        ...customStyle,
      }}
    >
      {label}
    </span>
  );
}

function OwnerBadge({ owner }: { owner: Owner }) {
  const meta = OWNER_COLORS[owner];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontFamily: C.mono,
        letterSpacing: 0.5,
        padding: "3px 8px",
        borderRadius: 3,
        background: meta.bg,
        color: meta.text,
        fontWeight: 600,
        minWidth: 50,
      }}
    >
      {meta.label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: C.serif,
        fontSize: 22,
        fontWeight: 600,
        color: C.cream,
        marginTop: 32,
        marginBottom: 16,
        paddingBottom: 8,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {children}
    </h2>
  );
}

function AccountCard({ account, holdings }: { account: FinancialAccount; holdings: FinancialHolding[] }) {
  const accountHoldings = holdings.filter((h) => h.accountId === account.id);
  const investmentValue = accountHoldings.reduce((sum, h) => sum + h.currentValue, 0);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = C.cardHov;
        (e.currentTarget as HTMLElement).style.borderColor = C.borderMid;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = C.card;
        (e.currentTarget as HTMLElement).style.borderColor = C.border;
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 4 }}>
            {account.institution}
          </div>
          <div style={{ color: C.cream, fontSize: 18, fontWeight: 600, fontFamily: C.mono }}>
            {formatCurrency(account.balance)}
          </div>
        </div>
        <OwnerBadge owner={account.owner} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Badge color={C.gem} label={account.accountType} />
        {investmentValue > 0 && (
          <div style={{ fontSize: 11, color: C.textDim, fontFamily: C.mono }}>
            {accountHoldings.length} holding{accountHoldings.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function NetWorthBanner({
  data,
  quotes,
}: {
  data: FinancialDashboardData;
  quotes: Record<string, StockQuote>;
}) {
  const isMobile = useMobile();
  const summary = adjustNetWorthWithQuotes(
    data.summary,
    data.accounts,
    data.holdings,
    data.rsuVests,
    quotes
  );

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${C.surface}cc 0%, ${C.card}cc 100%)`,
        border: `1px solid ${C.borderMid}`,
        borderRadius: 12,
        padding: 32,
        marginBottom: 32,
        textAlign: "center",
      }}
    >
      <div style={{ color: C.textDim, fontSize: 14, fontFamily: C.sans, marginBottom: 8 }}>
        Household Net Worth
      </div>
      <div
        style={{
          fontFamily: C.serif,
          fontSize: 48,
          fontWeight: 600,
          color: C.gold,
          marginBottom: 24,
        }}
      >
        {formatCurrency(summary.netWorth)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 12 : 24 }}>
        <div>
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 4 }}>
            Tyler Total
          </div>
          <div
            style={{
              color: OWNER_COLORS.tyler.bg,
              fontSize: 18,
              fontWeight: 600,
              fontFamily: C.mono,
            }}
          >
            {formatCurrency(summary.tylerAssets)}
          </div>
        </div>
        <div>
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 4 }}>
            Wife Total
          </div>
          <div
            style={{
              color: OWNER_COLORS.spouse.bg,
              fontSize: 18,
              fontWeight: 600,
              fontFamily: C.mono,
            }}
          >
            {formatCurrency(summary.spouseAssets)}
          </div>
        </div>
        <div>
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 4 }}>
            Total Debt
          </div>
          <div
            style={{
              color: C.reminder,
              fontSize: 18,
              fontWeight: 600,
              fontFamily: C.mono,
            }}
          >
            {formatCurrency(summary.totalDebt)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsSection({
  data,
  owner,
  title,
}: {
  data: FinancialDashboardData;
  owner: Owner | "business_only";
  title: string;
}) {
  const filteredAccounts =
    owner === "business_only"
      ? data.accounts.filter((a) => a.owner === "business")
      : data.accounts.filter((a) => a.owner === owner);

  if (filteredAccounts.length === 0) {
    return (
      <div>
        <SectionTitle>{title}</SectionTitle>
        <div style={{ color: C.textFaint, fontFamily: C.sans, fontSize: 13, padding: 20 }}>
          No accounts yet
        </div>
      </div>
    );
  }

  const grouped: Record<string, FinancialAccount[]> = {};
  for (const account of filteredAccounts) {
    let group = "Other";
    for (const [key, types] of Object.entries(ACCOUNT_TYPE_GROUPS)) {
      if ((types as readonly string[]).includes(account.accountType)) {
        group = key;
        break;
      }
    }
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(account);
  }

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {Object.entries(grouped).map(([group, accounts]) => (
        <div key={group}>
          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              fontFamily: C.sans,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 16,
              marginBottom: 8,
              paddingLeft: 2,
            }}
          >
            {group}
          </div>
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} holdings={data.holdings} />
          ))}
        </div>
      ))}
    </div>
  );
}

function RaiseAdjusterSection({
  data,
  newSalary,
  setNewSalary,
  raiseImpact,
}: {
  data: FinancialDashboardData;
  newSalary: number;
  setNewSalary: (n: number) => void;
  raiseImpact: RaiseImpact | null;
}) {
  const isMobile = useMobile();
  const currentSalary = parseInt(data.config?.annual_salary ?? "247800", 10);
  const previousSalary = data.config?.previous_salary ? parseInt(data.config.previous_salary, 10) : null;
  const raiseEffectiveDate = data.config?.raise_effective_date ?? null;
  const raisePct = data.config?.raise_pct ? parseFloat(data.config.raise_pct) : null;

  return (
    <div>
      <SectionTitle>Salary Adjustment</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 24,
        }}
      >
        {/* Raise banner — show if we have raise metadata in config */}
        {previousSalary && raiseEffectiveDate && (
          <div
            style={{
              background: `${C.todo}12`,
              border: `1px solid ${C.todo}30`,
              borderRadius: 6,
              padding: "12px 16px",
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ color: C.todo, fontSize: 13, fontWeight: 600, fontFamily: C.sans }}>
              AN26 Raise
            </div>
            <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.mono }}>
              {formatCurrency(previousSalary)} → {formatCurrency(currentSalary)}
            </div>
            {raisePct && (
              <div style={{ color: C.todo, fontSize: 12, fontFamily: C.mono }}>
                +{raisePct}%
              </div>
            )}
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans }}>
              Effective {new Date(raiseEffectiveDate + "T00:00:00").toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 32, marginBottom: isMobile ? 20 : 32 }}>
          <div>
            <label style={{ color: C.text, fontSize: 13, fontFamily: C.sans, display: "block", marginBottom: 8 }}>
              Current Annual Salary
            </label>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                fontFamily: C.mono,
                color: C.cream,
              }}
            >
              {formatCurrency(currentSalary)}
            </div>
          </div>
          <div>
            <label style={{ color: C.text, fontSize: 13, fontFamily: C.sans, display: "block", marginBottom: 8 }}>
              New Annual Salary
            </label>
            <input
              type="number"
              value={newSalary}
              onChange={(e) => setNewSalary(parseInt(e.target.value, 10) || currentSalary)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 16,
                fontFamily: C.mono,
                background: C.surface,
                border: `1px solid ${C.border}`,
                color: C.cream,
                borderRadius: 6,
              }}
            />
          </div>
        </div>

        {raiseImpact && (
          <div>
            <div
              style={{
                color: C.gold,
                fontSize: 13,
                fontFamily: C.sans,
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 16,
              }}
            >
              Impact
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 10 : 20, marginBottom: 24 }}>
              <div>
                <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                  BIWEEKLY GROSS
                </div>
                <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono, marginBottom: 4 }}>
                  {formatCurrency(raiseImpact.newBiweeklyGross)}
                </div>
                <div
                  style={{
                    color: raiseImpact.newBiweeklyGross > raiseImpact.currentBiweeklyGross ? C.todo : C.reminder,
                    fontSize: 11,
                    fontFamily: C.mono,
                  }}
                >
                  {formatDelta(raiseImpact.newBiweeklyGross - raiseImpact.currentBiweeklyGross)}
                </div>
              </div>

              <div>
                <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                  BIWEEKLY NET
                </div>
                <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono, marginBottom: 4 }}>
                  {formatCurrency(raiseImpact.newBiweeklyNet)}
                </div>
                <div
                  style={{
                    color: raiseImpact.newBiweeklyNet > raiseImpact.currentBiweeklyNet ? C.todo : C.reminder,
                    fontSize: 11,
                    fontFamily: C.mono,
                  }}
                >
                  {formatDelta(raiseImpact.newBiweeklyNet - raiseImpact.currentBiweeklyNet)}
                </div>
              </div>

              <div>
                <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                  ANNUAL NET
                </div>
                <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono, marginBottom: 4 }}>
                  {formatCurrency(raiseImpact.newAnnualNet)}
                </div>
                <div
                  style={{
                    color: raiseImpact.newAnnualNet > raiseImpact.currentAnnualNet ? C.todo : C.reminder,
                    fontSize: 11,
                    fontFamily: C.mono,
                  }}
                >
                  {formatDelta(raiseImpact.newAnnualNet - raiseImpact.currentAnnualNet)}
                </div>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20, marginBottom: 20 }}>
              <div
                style={{
                  color: C.gold,
                  fontSize: 13,
                  fontFamily: C.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                Monthly Surplus Change
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 10 : 20 }}>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    CURRENT
                  </div>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.currentMonthlySurplus)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    NEW
                  </div>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.newMonthlySurplus)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    DELTA
                  </div>
                  <div
                    style={{
                      color: raiseImpact.surplusDelta > 0 ? C.todo : C.reminder,
                      fontSize: 16,
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {formatDelta(raiseImpact.surplusDelta)}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
              <div
                style={{
                  color: C.gold,
                  fontSize: 13,
                  fontFamily: C.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                401k Impact (Annual)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 10 : 20 }}>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    CURRENT TOTAL
                  </div>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.current401kTotal)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    NEW TOTAL
                  </div>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.new401kTotal)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    DELTA
                  </div>
                  <div
                    style={{
                      color: raiseImpact.delta401k > 0 ? C.todo : C.reminder,
                      fontSize: 16,
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {formatDelta(raiseImpact.delta401k)}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 20, marginTop: 16 }}>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    CURRENT EMPLOYER MATCH
                  </div>
                  <div style={{ color: C.cream, fontSize: 14, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.currentEmployerMatch)}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                    NEW EMPLOYER MATCH
                  </div>
                  <div style={{ color: C.cream, fontSize: 14, fontWeight: 600, fontFamily: C.mono }}>
                    {formatCurrency(raiseImpact.newEmployerMatch)}
                  </div>
                </div>
              </div>
            </div>

            {raiseImpact.debtPayoffMonthsSaved > 0 && (
              <div style={{ marginTop: 20, padding: 12, background: C.surface, borderRadius: 6 }}>
                <div style={{ color: C.todo, fontSize: 12, fontFamily: C.sans }}>
                  💡 Could pay off all debt {Math.round(raiseImpact.debtPayoffMonthsSaved)} months faster
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DebtsSection({ data }: { data: FinancialDashboardData }) {
  const isMobile = useMobile();
  const activeDebts = data.debts.filter((d) => d.status === "active");

  if (activeDebts.length === 0) {
    return (
      <div>
        <SectionTitle>Debts</SectionTitle>
        <div style={{ color: C.textFaint, fontFamily: C.sans, fontSize: 13, padding: 20 }}>
          No active debts
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Debts</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: isMobile ? 12 : 16 }}>
        {activeDebts.map((debt) => {
          const projection = projectDebtPayoff(debt, debt.minPayment);
          const debtColor = DEBT_TYPE_COLORS[debt.debtType] || C.textDim;

          return (
            <div
              key={debt.id}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 16,
                borderLeftWidth: 4,
                borderLeftColor: debtColor,
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 4 }}>
                  {debt.institution}
                </div>
                <div style={{ color: C.cream, fontSize: 18, fontWeight: 600, fontFamily: C.mono }}>
                  {formatCurrency(debt.balance)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 2 }}>
                    APR
                  </div>
                  <div style={{ color: C.cream, fontSize: 14, fontFamily: C.mono }}>
                    {debt.apr.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 2 }}>
                    MIN PAYMENT
                  </div>
                  <div style={{ color: C.cream, fontSize: 14, fontFamily: C.mono }}>
                    {formatCurrency(debt.minPayment)}
                  </div>
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 4 }}>
                  PAYOFF IN
                </div>
                {projection.monthsToPayoff === Infinity ? (
                  <div style={{ color: C.reminder, fontSize: 12, fontFamily: C.sans }}>
                    {projection.payoffDate}
                  </div>
                ) : (
                  <>
                    <div style={{ color: C.cream, fontSize: 14, fontWeight: 600, fontFamily: C.mono }}>
                      {projection.monthsToPayoff} months
                    </div>
                    <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans, marginTop: 4 }}>
                      {projection.payoffDate}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContributionsSection({ data, currentSalary }: { data: FinancialDashboardData; currentSalary: number }) {
  const isMobile = useMobile();
  const { resolved } = resolveAllContributions(data.contributions, currentSalary);

  if (resolved.length === 0) {
    return (
      <div>
        <SectionTitle>Contributions</SectionTitle>
        <div style={{ color: C.textFaint, fontFamily: C.sans, fontSize: 13, padding: 20 }}>
          No active contributions configured
        </div>
      </div>
    );
  }

  const grouped: Record<string, typeof resolved> = {};
  for (const item of resolved) {
    const category = item.contribution.contributionType;
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }

  return (
    <div>
      <SectionTitle>Contributions</SectionTitle>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <div
            style={{
              color: C.textDim,
              fontSize: 12,
              fontFamily: C.sans,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 16,
              marginBottom: 8,
              paddingLeft: 2,
            }}
          >
            {category.replace(/_/g, " ")}
          </div>
          {items.map((item) => (
            <div
              key={item.contribution.id}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 8,
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr auto auto auto auto",
                gap: isMobile ? 8 : 16,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ color: C.text, fontSize: 13, fontFamily: C.sans }}>
                  {item.contribution.destination}
                </div>
                {item.contribution.isPercentage && (
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginTop: 2 }}>
                    {item.contribution.amount}% of salary
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>Per Check</div>
                <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>
                  {formatCurrency(item.resolvedAmount)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>Monthly</div>
                <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>
                  {formatCurrency(item.monthlyAmount)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>Annual</div>
                <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>
                  {formatCurrency(item.annualAmount)}
                </div>
              </div>
              <OwnerBadge owner={item.contribution.owner} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface AggregatedVest {
  vestDate: string;
  symbol: string;
  owner: Owner;
  totalShares: number;
  totalValue: number;
  grantIds: string[];
}

function RSUVestingSection({ data }: { data: FinancialDashboardData }) {
  const pendingVests = data.rsuVests.filter((v) => v.status === "pending");

  if (pendingVests.length === 0) {
    return (
      <div>
        <SectionTitle>RSU Vesting Timeline</SectionTitle>
        <div style={{ color: C.textFaint, fontFamily: C.sans, fontSize: 13, padding: 20 }}>
          No pending RSU vests
        </div>
      </div>
    );
  }

  // Aggregate vests by date + symbol + owner
  const aggregated = new Map<string, AggregatedVest>();
  for (const vest of pendingVests) {
    const key = `${vest.vestDate}|${vest.symbol}|${vest.owner}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.totalShares += vest.shares;
      existing.totalValue += vest.estimatedValue ?? 0;
      if (vest.grantId && !existing.grantIds.includes(vest.grantId)) {
        existing.grantIds.push(vest.grantId);
      }
    } else {
      aggregated.set(key, {
        vestDate: vest.vestDate,
        symbol: vest.symbol,
        owner: vest.owner,
        totalShares: vest.shares,
        totalValue: vest.estimatedValue ?? 0,
        grantIds: vest.grantId ? [vest.grantId] : [],
      });
    }
  }

  const sorted = [...aggregated.values()].sort(
    (a, b) => new Date(a.vestDate).getTime() - new Date(b.vestDate).getTime()
  );

  return (
    <div>
      <SectionTitle>RSU Vesting Timeline</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 24,
          overflowX: "auto",
        }}
      >
        <div style={{ display: "flex", gap: 16, minWidth: "min-content" }}>
          {sorted.map((vest) => {
            const vestDate = new Date(vest.vestDate);
            const isUpcoming = vestDate > new Date();
            const grantCount = vest.grantIds.length;

            return (
              <div
                key={`${vest.vestDate}-${vest.symbol}-${vest.owner}`}
                style={{
                  flex: "0 0 auto",
                  background: isUpcoming ? C.surface : `${C.gold}15`,
                  border: `1px solid ${isUpcoming ? C.border : C.gold}40`,
                  borderRadius: 6,
                  padding: 12,
                  minWidth: 180,
                }}
              >
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 6 }}>
                  {vestDate.toLocaleDateString()}
                </div>
                <div
                  style={{
                    color: C.cream,
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: C.mono,
                    marginBottom: 8,
                  }}
                >
                  {Math.floor(vest.totalShares)} shares
                </div>
                <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans, marginBottom: 4 }}>
                  {vest.symbol}
                  {grantCount > 1 && (
                    <span style={{ color: C.textFaint, marginLeft: 6, fontSize: 10 }}>
                      ({grantCount} grants)
                    </span>
                  )}
                </div>
                {vest.totalValue > 0 && (
                  <div
                    style={{
                      color: isUpcoming ? C.gold : C.cream,
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: C.mono,
                      marginBottom: 4,
                    }}
                  >
                    {formatCurrency(vest.totalValue)}
                  </div>
                )}
                <OwnerBadge owner={vest.owner} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MarketStatusBadge({ marketState, fetchedAt, loading, onRefresh }: {
  marketState: string | null;
  fetchedAt: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const isOpen = marketState === "REGULAR";
  const isPre = marketState === "PRE";
  const isPost = marketState === "POST" || marketState === "POSTPOST";
  const statusColor = isOpen ? C.todo : isPre || isPost ? C.task : C.textDim;
  const statusLabel = isOpen ? "Market Open" : isPre ? "Pre-Market" : isPost ? "After Hours" : "Market Closed";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: isOpen ? `0 0 6px ${statusColor}` : "none",
            animation: isOpen ? "pulse 2s infinite" : "none",
          }}
        />
        <span style={{ color: statusColor, fontSize: 11, fontFamily: C.mono, fontWeight: 600 }}>
          {statusLabel}
        </span>
      </div>
      {fetchedAt && (
        <span style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono }}>
          Updated {new Date(fetchedAt).toLocaleTimeString()}
        </span>
      )}
      <button
        onClick={onRefresh}
        disabled={loading}
        style={{
          background: "none",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          padding: "2px 8px",
          color: loading ? C.textFaint : C.textDim,
          fontSize: 10,
          fontFamily: C.mono,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "..." : "Refresh"}
      </button>
    </div>
  );
}

// ── Performance Metric Pill ──────────────────────────────────

function MetricPill({ label, value, pct }: { label: string; value: number; pct: number }) {
  const isUp = value >= 0;
  const color = isUp ? C.todo : C.reminder;
  return (
    <div style={{
      background: `${color}10`,
      border: `1px solid ${color}25`,
      borderRadius: 6,
      padding: "6px 10px",
      minWidth: 90,
      textAlign: "center",
    }}>
      <div style={{ color: C.textDim, fontSize: 9, fontFamily: C.mono, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 12, fontWeight: 600, fontFamily: C.mono }}>
        {isUp ? "+" : ""}{formatCurrency(value)}
      </div>
      <div style={{ color, fontSize: 10, fontFamily: C.mono }}>
        {formatPercent(pct)}
      </div>
    </div>
  );
}

function LiveHoldingsSection({
  data,
  quotes,
  quotesLoading,
  quotesError,
  fetchedAt,
  marketState,
  onRefresh,
  historicalData,
}: {
  data: FinancialDashboardData;
  quotes: Record<string, StockQuote>;
  quotesLoading: boolean;
  quotesError: string | null;
  fetchedAt: string | null;
  marketState: string | null;
  onRefresh: () => void;
  historicalData: Record<string, HistoricalPrices>;
}) {
  const isMobile = useMobile();
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  // Group holdings by account
  const accountMap = new Map<string, FinancialAccount>();
  for (const acct of data.accounts) accountMap.set(acct.id, acct);

  const holdingsByAccount = new Map<string, FinancialHolding[]>();
  for (const h of data.holdings) {
    const list = holdingsByAccount.get(h.accountId) || [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }

  // Compute total portfolio value with live prices
  let totalPortfolioValue = 0;
  let totalDayChange = 0;
  const currentPrices: Record<string, number> = {};
  for (const h of data.holdings) {
    const quote = quotes[h.symbol];
    if (quote) {
      totalPortfolioValue += quote.price * h.shares;
      totalDayChange += quote.change * h.shares;
      currentPrices[h.symbol] = quote.price;
    } else {
      totalPortfolioValue += h.currentValue;
      if (h.currentPrice) currentPrices[h.symbol] = h.currentPrice;
    }
  }

  const hasQuotes = Object.keys(quotes).length > 0;
  const hasHistorical = Object.keys(historicalData).length > 0;

  // Portfolio-level performance
  const portfolioPerf = hasHistorical
    ? calculatePortfolioPerformance(data.holdings, currentPrices, historicalData)
    : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 8, marginTop: 32, marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 600, color: C.cream, margin: 0 }}>
          Live Holdings
        </h2>
        <MarketStatusBadge marketState={marketState} fetchedAt={fetchedAt} loading={quotesLoading} onRefresh={onRefresh} />
      </div>

      {quotesError && (
        <div style={{ padding: "8px 14px", marginBottom: 16, borderRadius: 6, fontSize: 12, fontFamily: C.mono, background: `${C.reminder}15`, color: C.reminder, border: `1px solid ${C.reminder}30` }}>
          {quotesError}
        </div>
      )}

      {/* Portfolio summary bar */}
      {hasQuotes && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? 16 : 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: portfolioPerf ? 16 : 0 }}>
            <div>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>TOTAL HOLDINGS VALUE</div>
              <div style={{ color: C.gold, fontSize: 28, fontWeight: 600, fontFamily: C.mono }}>
                {formatCurrency(totalPortfolioValue)}
              </div>
            </div>
            <div style={{ textAlign: isMobile ? "left" : "right" }}>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>DAY CHANGE</div>
              <div style={{ color: totalDayChange >= 0 ? C.todo : C.reminder, fontSize: 22, fontWeight: 600, fontFamily: C.mono }}>
                {totalDayChange >= 0 ? "+" : ""}{formatCurrency(totalDayChange)}
              </div>
            </div>
          </div>

          {/* Performance metrics row */}
          {portfolioPerf && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <MetricPill label="1D" value={portfolioPerf.dailyChange} pct={portfolioPerf.dailyChangePct} />
              <MetricPill label="1W" value={portfolioPerf.weekChange} pct={portfolioPerf.weekChangePct} />
              <MetricPill label="1M" value={portfolioPerf.monthChange} pct={portfolioPerf.monthChangePct} />
              <MetricPill label="YTD" value={portfolioPerf.ytdChange} pct={portfolioPerf.ytdChangePct} />
              <MetricPill label="1Y" value={portfolioPerf.yearChange} pct={portfolioPerf.yearChangePct} />
              <MetricPill label="TOTAL" value={portfolioPerf.totalReturn} pct={portfolioPerf.totalReturnPct} />
            </div>
          )}
        </div>
      )}

      {/* Holdings by account */}
      {[...holdingsByAccount.entries()].map(([accountId, holdings]) => {
        const account = accountMap.get(accountId);
        if (!account) return null;

        const isExpanded = expandedAccount === accountId;
        const sorted = [...holdings].sort((a, b) => {
          const aVal = quotes[a.symbol] ? quotes[a.symbol].price * a.shares : a.currentValue;
          const bVal = quotes[b.symbol] ? quotes[b.symbol].price * b.shares : b.currentValue;
          return bVal - aVal;
        });

        let accountLiveTotal = 0;
        let accountDayChange = 0;
        for (const h of holdings) {
          const q = quotes[h.symbol];
          if (q) {
            accountLiveTotal += q.price * h.shares;
            accountDayChange += q.change * h.shares;
          } else {
            accountLiveTotal += h.currentValue;
          }
        }

        return (
          <div key={accountId} style={{ marginBottom: 12 }}>
            <div
              onClick={() => setExpandedAccount(isExpanded ? null : accountId)}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: isExpanded ? "8px 8px 0 0" : 8,
                padding: "12px 16px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.cardHov; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = C.card; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: C.textFaint, fontSize: 14, fontFamily: C.mono, transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                  ▶
                </span>
                <div>
                  <div style={{ color: C.cream, fontSize: 14, fontFamily: C.sans, fontWeight: 500 }}>
                    {account.accountName}
                  </div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans }}>
                    {account.institution} · {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.cream, fontSize: 16, fontWeight: 600, fontFamily: C.mono }}>
                  {formatCurrency(accountLiveTotal)}
                </div>
                {hasQuotes && (
                  <div style={{ color: accountDayChange >= 0 ? C.todo : C.reminder, fontSize: 11, fontFamily: C.mono }}>
                    {accountDayChange >= 0 ? "+" : ""}{formatCurrency(accountDayChange)}
                  </div>
                )}
              </div>
            </div>

            {isExpanded && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: isMobile ? 8 : 0 }}>
                {/* Header row */}
                {!isMobile && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr", gap: 4, padding: "8px 16px", borderBottom: `1px solid ${C.border}` }}>
                    {["Symbol", "Shares", "Price", "Day", "1W", "1M", "YTD", "Total", "Value"].map((h) => (
                      <div key={h} style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono, textTransform: "uppercase", textAlign: h === "Symbol" ? "left" : "right" }}>{h}</div>
                    ))}
                  </div>
                )}
                {sorted.map((holding) => {
                  const quote = quotes[holding.symbol];
                  const livePrice = quote?.price ?? holding.currentPrice ?? 0;
                  const liveValue = livePrice * holding.shares;
                  const dayChange = quote ? quote.change * holding.shares : 0;
                  const changePct = quote?.changePercent ?? 0;
                  const isUp = (quote?.change ?? 0) >= 0;

                  const holdingPerf = hasHistorical && holding.holdingType !== "cash"
                    ? calculateHoldingPerformance(holding, livePrice, historicalData[holding.symbol])
                    : null;

                  if (isMobile) {
                    return (
                      <div key={holding.id} style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <div>
                            <span style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>{holding.symbol}</span>
                            {holding.name && <span style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans, marginLeft: 6 }}>{holding.name}</span>}
                          </div>
                          <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>{formatCurrency(liveValue)}</div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: holdingPerf ? 6 : 0 }}>
                          <span style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono }}>{holding.shares.toLocaleString()} @ {formatCurrency(livePrice)}</span>
                          <span style={{ color: isUp ? C.todo : C.reminder, fontSize: 11, fontFamily: C.mono }}>
                            {isUp ? "+" : ""}{formatCurrency(dayChange)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                          </span>
                        </div>
                        {holdingPerf && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {[
                              { l: "1W", v: holdingPerf.weekChangePct },
                              { l: "1M", v: holdingPerf.monthChangePct },
                              { l: "YTD", v: holdingPerf.ytdChangePct },
                              { l: "Tot", v: holdingPerf.totalReturnPct },
                            ].map((m) => (
                              <span key={m.l} style={{
                                fontSize: 10,
                                fontFamily: C.mono,
                                color: m.v >= 0 ? C.todo : C.reminder,
                                background: `${m.v >= 0 ? C.todo : C.reminder}10`,
                                padding: "1px 5px",
                                borderRadius: 3,
                              }}>
                                {m.l}: {formatPercent(m.v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={holding.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr", gap: 4, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
                      <div>
                        <span style={{ color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>{holding.symbol}</span>
                        {holding.name && <span style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans, marginLeft: 8 }}>{holding.name}</span>}
                      </div>
                      <div style={{ textAlign: "right", color: C.text, fontSize: 13, fontFamily: C.mono }}>{holding.shares.toLocaleString()}</div>
                      <div style={{ textAlign: "right", color: C.cream, fontSize: 13, fontFamily: C.mono }}>{formatCurrency(livePrice)}</div>
                      <div style={{ textAlign: "right", color: isUp ? C.todo : C.reminder, fontSize: 12, fontFamily: C.mono }}>
                        {formatPercent(changePct)}
                      </div>
                      <div style={{ textAlign: "right", color: (holdingPerf?.weekChangePct ?? 0) >= 0 ? C.todo : C.reminder, fontSize: 12, fontFamily: C.mono }}>
                        {holdingPerf ? formatPercent(holdingPerf.weekChangePct) : "—"}
                      </div>
                      <div style={{ textAlign: "right", color: (holdingPerf?.monthChangePct ?? 0) >= 0 ? C.todo : C.reminder, fontSize: 12, fontFamily: C.mono }}>
                        {holdingPerf ? formatPercent(holdingPerf.monthChangePct) : "—"}
                      </div>
                      <div style={{ textAlign: "right", color: (holdingPerf?.ytdChangePct ?? 0) >= 0 ? C.todo : C.reminder, fontSize: 12, fontFamily: C.mono }}>
                        {holdingPerf ? formatPercent(holdingPerf.ytdChangePct) : "—"}
                      </div>
                      <div style={{ textAlign: "right", color: (holdingPerf?.totalReturnPct ?? 0) >= 0 ? C.todo : C.reminder, fontSize: 12, fontFamily: C.mono }}>
                        {holdingPerf ? formatPercent(holdingPerf.totalReturnPct) : "—"}
                      </div>
                      <div style={{ textAlign: "right", color: C.cream, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>{formatCurrency(liveValue)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CashFlowSection({ data }: { data: FinancialDashboardData }) {
  const isMobile = useMobile();
  const cf = data.cashFlow;

  const waterfallItems = [
    { label: "Monthly Gross Income", value: cf.monthlyGrossIncome, color: C.gold },
    { label: "After Taxes (~30%)", value: cf.monthlyNetIncome, color: C.gem },
    { label: "401k & Contributions", value: cf.monthlyContributions, color: C.task, subtract: true },
    { label: "Debt Payments", value: cf.monthlyDebtPayments, color: C.reminder, subtract: true },
    { label: "Expenses", value: cf.estimatedExpenses, color: C.cl, subtract: true },
    { label: "Monthly Surplus", value: Math.max(0, cf.monthlySurplus), color: C.todo },
  ];

  return (
    <div>
      <SectionTitle>Cash Flow Summary</SectionTitle>

      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 32, marginBottom: isMobile ? 20 : 32 }}>
          <div>
            <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 8 }}>
              Monthly Gross Income
            </div>
            <div style={{ color: C.gold, fontSize: 24, fontWeight: 600, fontFamily: C.mono }}>
              {formatCurrency(cf.monthlyGrossIncome)}
            </div>
          </div>
          <div>
            <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 8 }}>
              Annual Surplus
            </div>
            <div style={{ color: C.todo, fontSize: 24, fontWeight: 600, fontFamily: C.mono }}>
              {formatCurrency(cf.annualSurplus)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {waterfallItems.map((item, idx) => (
            <div key={idx}>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, marginBottom: 4 }}>
                {item.label}
              </div>
              <div
                style={{
                  color: item.color,
                  fontSize: 18,
                  fontWeight: 600,
                  fontFamily: C.mono,
                }}
              >
                {item.subtract ? "−" : ""}
                {formatCurrency(item.value)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: C.sans, marginBottom: 8 }}>
            Savings Rate
          </div>
          <div style={{ color: C.todo, fontSize: 20, fontWeight: 600, fontFamily: C.mono }}>
            {cf.savingsRate.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NET WORTH FORECAST SECTION
// ─────────────────────────────────────────────────────────────────────────────

const HORIZON_OPTIONS = [
  { label: "1Y", months: 12 },
  { label: "3Y", months: 36 },
  { label: "5Y", months: 60 },
  { label: "10Y", months: 120 },
];

interface ForecastAssumptions {
  brokerage: AssetClassParams;
  rothIra: AssetClassParams;
  retirement: AssetClassParams;
  crypto: AssetClassParams;
  equityAwards: AssetClassParams;
  salaryGrowthAnnual: number;
  expenseInflationAnnual: number;
}

const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  brokerage: { ...ASSET_CLASS_DEFAULTS.brokerage },
  rothIra: { ...ASSET_CLASS_DEFAULTS.rothIra },
  retirement: { ...ASSET_CLASS_DEFAULTS.retirement },
  crypto: { ...ASSET_CLASS_DEFAULTS.crypto },
  equityAwards: { ...ASSET_CLASS_DEFAULTS.equityAwards },
  salaryGrowthAnnual: 0.04,
  expenseInflationAnnual: 0.03,
};

function ForecastSection({ data }: { data: FinancialDashboardData }) {
  const isMobile = useMobile();
  const [horizon, setHorizon] = useState(60);
  const [showSettings, setShowSettings] = useState(false);
  const [assumptions, setAssumptions] = useState<ForecastAssumptions>(DEFAULT_ASSUMPTIONS);

  const summary = data.summary;
  const monthlyExpenses = parseFloat(data.config?.monthly_expenses ?? "12000");
  const annualSalary = parseFloat(data.config?.annual_salary ?? "247800");
  const rsuOffsets = rsuVestsToMonthOffsets(data.rsuVests);

  // Calculate actual monthly contribution amounts per bucket
  // Brokerage: $1,000 biweekly = $2,166.67/mo
  const monthlyBrokerageContrib = 1000 * (26 / 12);
  // 401k: 10% pre-tax + 15% after-tax + 4% match = 29% of salary / 12
  const monthlyRetirementContrib = annualSalary * 0.29 / 12;
  // Roth IRA: $7K/yr Tyler + $7K/yr spouse = $14K/yr
  const monthlyRothIraContrib = 14000 / 12;
  // Crypto DCA: $500/mo
  const monthlyCryptoContrib = 500;

  const forecastInput: ForecastInput = {
    brokerageValue: summary.investedAssets,
    rothIraValue: (data.accounts
      .filter((a) => a.accountType === "roth_ira")
      .reduce((sum, a) => sum + Number(a.balance), 0)),
    retirementValue: (data.accounts
      .filter((a) => a.accountType === "401k")
      .reduce((sum, a) => sum + Number(a.balance), 0)),
    cryptoValue: summary.cryptoAssets,
    cashPosition: summary.cashPosition,
    totalDebt: summary.totalDebt,
    unvestedRSUs: rsuOffsets,
    rsuTaxRate: 0.37,
    monthlyBrokerageContrib,
    monthlyRetirementContrib,
    monthlyRothIraContrib,
    monthlyCryptoContrib,
    monthlyNetIncome: data.cashFlow.monthlyNetIncome,
    monthlyExpenses,
    brokerageReturn: assumptions.brokerage,
    rothIraReturn: assumptions.rothIra,
    retirementReturn: assumptions.retirement,
    cryptoReturn: assumptions.crypto,
    equityAwardsReturn: assumptions.equityAwards,
    salaryGrowthAnnual: assumptions.salaryGrowthAnnual,
    expenseInflationAnnual: assumptions.expenseInflationAnnual,
  };

  const forecast = runNetWorthForecast(forecastInput, horizon, 1000);

  // Build chart data
  const chartData = forecast.months.map((m, i) => ({
    month: m,
    label: forecast.labels[i],
    p10: Math.round(forecast.p10[i]),
    p25: Math.round(forecast.p25[i]),
    p50: Math.round(forecast.p50[i]),
    p75: Math.round(forecast.p75[i]),
    p90: Math.round(forecast.p90[i]),
    // For area bands
    band_outer_low: Math.round(forecast.p10[i]),
    band_outer_high: Math.round(forecast.p90[i] - forecast.p10[i]),
    band_inner_low: Math.round(forecast.p25[i]),
    band_inner_high: Math.round(forecast.p75[i] - forecast.p25[i]),
  }));

  // Find milestone crossings on P50
  const milestones: Array<{ value: number; label: string; month: number; date: string }> = [];
  const milestoneTargets = [500000, 750000, 1000000, 1500000, 2000000, 3000000, 5000000];
  for (const target of milestoneTargets) {
    if (forecast.p50[0] >= target) continue; // already past it
    const idx = forecast.p50.findIndex((v) => v >= target);
    if (idx > 0 && idx < forecast.p50.length) {
      milestones.push({
        value: target,
        label: target >= 1000000 ? `$${(target / 1000000).toFixed(target % 1000000 === 0 ? 0 : 1)}M` : `$${(target / 1000).toFixed(0)}K`,
        month: idx,
        date: forecast.labels[idx],
      });
    }
  }

  const formatYAxis = (v: number) => {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
    return `$${v}`;
  };

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; p10: number; p25: number; p50: number; p75: number; p90: number } }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, fontFamily: C.mono, fontSize: 11 }}>
        <div style={{ color: C.cream, fontWeight: 600, marginBottom: 6 }}>{d.label}</div>
        <div style={{ color: C.textDim }}>P90: <span style={{ color: C.todo }}>{formatCurrency(d.p90)}</span></div>
        <div style={{ color: C.textDim }}>P75: <span style={{ color: C.todo }}>{formatCurrency(d.p75)}</span></div>
        <div style={{ color: C.gold, fontWeight: 600 }}>P50: {formatCurrency(d.p50)}</div>
        <div style={{ color: C.textDim }}>P25: <span style={{ color: C.reminder }}>{formatCurrency(d.p25)}</span></div>
        <div style={{ color: C.textDim }}>P10: <span style={{ color: C.reminder }}>{formatCurrency(d.p10)}</span></div>
      </div>
    );
  };

  const sliderStyle: React.CSSProperties = {
    width: "100%",
    accentColor: C.gold,
    cursor: "pointer",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 8, marginTop: 32, marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 600, color: C.cream, margin: 0 }}>
          Net Worth Forecast
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Horizon toggle */}
          <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 6, padding: 2 }}>
            {HORIZON_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setHorizon(opt.months)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontFamily: C.mono,
                  background: horizon === opt.months ? C.gold : "transparent",
                  color: horizon === opt.months ? C.bg : C.textDim,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: horizon === opt.months ? 700 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontFamily: C.mono,
              background: showSettings ? C.cardHov : C.card,
              color: C.textDim,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
          {/* Per-account return assumptions */}
          <div style={{ color: C.gold, fontSize: 11, fontFamily: C.mono, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Return Assumptions by Account</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 20 }}>
            {([
              { key: "brokerage" as const, label: "Brokerage (SPY/QQQ)", color: C.gem },
              { key: "rothIra" as const, label: "Roth IRA (Growth ETFs)", color: C.todo },
              { key: "retirement" as const, label: "401k/MBDR (FUIPX)", color: C.note },
              { key: "crypto" as const, label: "Crypto (BTC/ETH/SOL)", color: C.task },
              { key: "equityAwards" as const, label: "Equity Awards (CART)", color: C.cl },
            ]).map(({ key, label, color }) => (
              <div key={key} style={{ background: C.surface, borderRadius: 6, padding: 12, border: `1px solid ${color}20` }}>
                <div style={{ color, fontSize: 10, fontFamily: C.mono, marginBottom: 8, fontWeight: 600 }}>{label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ color: C.textDim, fontSize: 9, fontFamily: C.mono, marginBottom: 4 }}>RETURN</div>
                    <input type="range" min="0" max={key === "crypto" ? "50" : "25"} step="0.5"
                      value={assumptions[key].returnAnnual * 100}
                      onChange={(e) => setAssumptions({ ...assumptions, [key]: { ...assumptions[key], returnAnnual: parseFloat(e.target.value) / 100 } })}
                      style={{ ...sliderStyle, accentColor: color }} />
                    <div style={{ color: C.cream, fontSize: 11, fontFamily: C.mono, textAlign: "center" }}>{(assumptions[key].returnAnnual * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div style={{ color: C.textDim, fontSize: 9, fontFamily: C.mono, marginBottom: 4 }}>VOLATILITY</div>
                    <input type="range" min="1" max={key === "crypto" ? "80" : "50"} step="0.5"
                      value={assumptions[key].volAnnual * 100}
                      onChange={(e) => setAssumptions({ ...assumptions, [key]: { ...assumptions[key], volAnnual: parseFloat(e.target.value) / 100 } })}
                      style={{ ...sliderStyle, accentColor: color }} />
                    <div style={{ color: C.cream, fontSize: 11, fontFamily: C.mono, textAlign: "center" }}>{(assumptions[key].volAnnual * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Growth rates */}
          <div style={{ color: C.gold, fontSize: 11, fontFamily: C.mono, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Income & Expense Growth</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 6 }}>SALARY GROWTH (ANNUAL)</div>
              <input type="range" min="0" max="10" step="0.5" value={assumptions.salaryGrowthAnnual * 100} onChange={(e) => setAssumptions({ ...assumptions, salaryGrowthAnnual: parseFloat(e.target.value) / 100 })} style={sliderStyle} />
              <div style={{ color: C.cream, fontSize: 12, fontFamily: C.mono, textAlign: "center" }}>{(assumptions.salaryGrowthAnnual * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 6 }}>EXPENSE INFLATION (ANNUAL)</div>
              <input type="range" min="0" max="10" step="0.5" value={assumptions.expenseInflationAnnual * 100} onChange={(e) => setAssumptions({ ...assumptions, expenseInflationAnnual: parseFloat(e.target.value) / 100 })} style={sliderStyle} />
              <div style={{ color: C.cream, fontSize: 12, fontFamily: C.mono, textAlign: "center" }}>{(assumptions.expenseInflationAnnual * 100).toFixed(1)}%</div>
            </div>
          </div>
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <button
              onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}
              style={{ padding: "4px 12px", fontSize: 11, fontFamily: C.mono, background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 4, cursor: "pointer" }}
            >
              Reset Defaults
            </button>
          </div>
        </div>
      )}

      {/* Chart */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? "12px 4px" : "20px 20px 20px 0" }}>
        <ResponsiveContainer width="100%" height={isMobile ? 300 : 400}>
          <AreaChart data={chartData} margin={{ top: 10, right: 20, left: isMobile ? 10 : 20, bottom: 10 }}>
            <defs>
              <linearGradient id="bandOuter" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.gold} stopOpacity={0.08} />
                <stop offset="100%" stopColor={C.gold} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="bandInner" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.gold} stopOpacity={0.15} />
                <stop offset="100%" stopColor={C.gold} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fill: C.textDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={{ stroke: C.border }}
              interval={Math.max(1, Math.floor(chartData.length / (isMobile ? 4 : 8)))}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fill: C.textDim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              tickLine={false}
              axisLine={false}
              width={isMobile ? 45 : 65}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* P10-P90 band */}
            <Area type="monotone" dataKey="p90" stroke="none" fill="none" />
            <Area type="monotone" dataKey="p10" stroke="none" fill="url(#bandOuter)" fillOpacity={1}
              stackId="outer" />
            <Area type="monotone" dataKey="p90" stroke="none" fill="url(#bandOuter)" fillOpacity={1} />
            {/* P25-P75 band */}
            <Area type="monotone" dataKey="p75" stroke="none" fill="none" />
            <Area type="monotone" dataKey="p25" stroke="none" fill="url(#bandInner)" fillOpacity={1} />
            <Area type="monotone" dataKey="p75" stroke="none" fill="url(#bandInner)" fillOpacity={1} />
            {/* P50 median line */}
            <Area
              type="monotone"
              dataKey="p50"
              stroke={C.gold}
              strokeWidth={2}
              fill="none"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 20, height: 2, background: C.gold }} />
            <span style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>Median (P50)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 20, height: 10, background: `${C.gold}25`, borderRadius: 2 }} />
            <span style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>P25-P75</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 20, height: 10, background: `${C.gold}10`, borderRadius: 2 }} />
            <span style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>P10-P90</span>
          </div>
        </div>
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {milestones.map((m) => (
            <div key={m.value} style={{
              background: C.card,
              border: `1px solid ${C.gold}30`,
              borderRadius: 6,
              padding: "8px 14px",
              textAlign: "center",
            }}>
              <div style={{ color: C.gold, fontSize: 16, fontWeight: 700, fontFamily: C.mono }}>{m.label}</div>
              <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono }}>{m.date}</div>
              <div style={{ color: C.textFaint, fontSize: 9, fontFamily: C.mono }}>~{m.month} months</div>
            </div>
          ))}
        </div>
      )}

      {/* Assumptions summary */}
      <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ color: C.textDim, fontSize: 10, fontFamily: C.mono, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Allocation & Assumptions</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
          {[
            { l: "Brokerage → SPY/QQQ", v: `${(assumptions.brokerage.returnAnnual * 100).toFixed(0)}% ret, ${(assumptions.brokerage.volAnnual * 100).toFixed(0)}% vol`, c: formatCurrency(monthlyBrokerageContrib) + "/mo" },
            { l: "Roth IRA → Growth ETFs", v: `${(assumptions.rothIra.returnAnnual * 100).toFixed(0)}% ret, ${(assumptions.rothIra.volAnnual * 100).toFixed(0)}% vol`, c: formatCurrency(monthlyRothIraContrib) + "/mo" },
            { l: "401k/MBDR → FUIPX", v: `${(assumptions.retirement.returnAnnual * 100).toFixed(0)}% ret, ${(assumptions.retirement.volAnnual * 100).toFixed(0)}% vol`, c: formatCurrency(monthlyRetirementContrib) + "/mo" },
            { l: "Crypto → BTC/ETH/SOL", v: `${(assumptions.crypto.returnAnnual * 100).toFixed(0)}% ret, ${(assumptions.crypto.volAnnual * 100).toFixed(0)}% vol`, c: formatCurrency(monthlyCryptoContrib) + "/mo" },
            { l: "CART Equity Awards", v: `${(assumptions.equityAwards.returnAnnual * 100).toFixed(0)}% ret, ${(assumptions.equityAwards.volAnnual * 100).toFixed(0)}% vol`, c: "RSU vests" },
            { l: "Salary Growth", v: `${(assumptions.salaryGrowthAnnual * 100).toFixed(1)}%/yr`, c: "" },
            { l: "Expense Inflation", v: `${(assumptions.expenseInflationAnnual * 100).toFixed(1)}%/yr`, c: "" },
            { l: "Monthly Expenses", v: formatCurrency(monthlyExpenses), c: "$4,540 rent + $7,460 other" },
            { l: "Simulations", v: "1,000 Monte Carlo paths", c: "" },
          ].map((item) => (
            <div key={item.l}>
              <div style={{ color: C.textFaint, fontSize: 9, fontFamily: C.mono }}>{item.l}</div>
              <div style={{ color: C.text, fontSize: 11, fontFamily: C.mono }}>{item.v}</div>
              {item.c && <div style={{ color: C.textDim, fontSize: 9, fontFamily: C.mono }}>{item.c}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const isMobile = useMobile();
  const [data, setData] = useState<FinancialDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newSalary, setNewSalary] = useState(0);
  const [raiseImpact, setRaiseImpact] = useState<RaiseImpact | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ ok: boolean; message: string } | null>(null);

  const currentSalary = data ? parseInt(data.config?.annual_salary ?? "247800", 10) : 247800;

  // Collect unique symbols from holdings and RSU vests for live quotes
  const symbols = data
    ? [
        ...new Set([
          ...data.holdings.map((h) => h.symbol),
          ...data.rsuVests.filter((v) => v.status === "pending").map((v) => v.symbol),
        ]),
      ].filter(Boolean)
    : [];

  const { quotes, loading: quotesLoading, error: quotesError, fetchedAt, marketState, refetch: refetchQuotes } = useStockQuotes(symbols);
  const { historical: historicalData } = useHistoricalQuotes(symbols);

  const fetchFinanceData = useCallback(async () => {
    try {
      const result = await api<FinancialDashboardData>("/api/finance");
      setData(result);
      setNewSalary(parseInt(result.config?.annual_salary ?? "247800", 10));
    } catch (err) {
      console.error("Failed to load financial data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFinanceData();
  }, [fetchFinanceData]);

  useEffect(() => {
    if (!data) return;

    const current = currentSalary;
    const biweeklyNetCurrent = (current * 0.7) / 26; // Rough estimate of net per paycheck

    const impact = calculateRaiseImpact(
      current,
      newSalary,
      biweeklyNetCurrent,
      data.contributions,
      0.3,
      data.cashFlow.monthlySurplus,
      data.summary.totalDebt
    );

    setRaiseImpact(impact);
  }, [newSalary, data, currentSalary]);

  if (loading) {
    return <LoadingPage />;
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.reminder }}>
        <div style={{ fontFamily: C.sans }}>Failed to load financial data</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: isMobile ? "20px 14px" : "40px 60px", fontFamily: C.sans }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "flex-start", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 8 : 0 }}>
          <div>
            <h1
              style={{
                fontFamily: C.serif,
                fontSize: isMobile ? 28 : 44,
                fontWeight: 600,
                color: C.cream,
                marginBottom: 8,
              }}
            >
              Financial OS
            </h1>
            <div style={{ color: C.textDim, fontSize: 14, marginBottom: 40 }}>
              Comprehensive household financial overview and projections
            </div>
          </div>
          <button
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              setSeedResult(null);
              try {
                const res = await fetch("/api/finance/seed", { method: "POST" });
                const json = await res.json();
                if (res.ok) {
                  setSeedResult({ ok: true, message: json.message ?? "Seed complete" });
                  // Refresh dashboard data
                  const fresh = await api<FinancialDashboardData>("/api/finance");
                  setData(fresh);
                  setNewSalary(parseInt(fresh.config?.annual_salary ?? "247800", 10));
                } else {
                  setSeedResult({ ok: false, message: json.error ?? "Seed failed" });
                }
              } catch (err) {
                setSeedResult({ ok: false, message: String(err) });
              } finally {
                setSeeding(false);
              }
            }}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: C.mono,
              background: seeding ? C.surface : C.card,
              color: seeding ? C.textDim : C.gold,
              border: `1px solid ${C.gold}40`,
              borderRadius: 6,
              cursor: seeding ? "not-allowed" : "pointer",
              opacity: seeding ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {seeding ? "Seeding..." : "Re-seed Data"}
          </button>
        </div>
        {seedResult && (
          <div
            style={{
              padding: "8px 14px",
              marginBottom: 16,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: C.mono,
              background: seedResult.ok ? `${C.todo}15` : `${C.reminder}15`,
              color: seedResult.ok ? C.todo : C.reminder,
              border: `1px solid ${seedResult.ok ? C.todo : C.reminder}30`,
            }}
          >
            {seedResult.message}
          </div>
        )}

        {/* Net Worth Banner */}
        <NetWorthBanner data={data} quotes={quotes} />

        {/* Two-Column Accounts Layout */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 40, marginBottom: isMobile ? 20 : 40 }}>
          <AccountsSection data={data} owner="tyler" title="Tyler's Accounts" />
          <div>
            <AccountsSection data={data} owner="spouse" title="Wife's Accounts" />
            <div style={{ marginTop: 40 }}>
              <AccountsSection data={data} owner="business_only" title="Business" />
            </div>
          </div>
        </div>

        {/* Net Worth Forecast */}
        <ForecastSection data={data} />

        <WealthAdvisorSection advisor={data.wealthAdvisor} statements={data.statements ?? []} onUploaded={fetchFinanceData} />

        {/* Live Holdings */}
        <LiveHoldingsSection
          data={data}
          quotes={quotes}
          quotesLoading={quotesLoading}
          quotesError={quotesError}
          fetchedAt={fetchedAt}
          marketState={marketState}
          onRefresh={refetchQuotes}
          historicalData={historicalData}
        />

        {/* Raise Adjuster */}
        <RaiseAdjusterSection data={data} newSalary={newSalary} setNewSalary={setNewSalary} raiseImpact={raiseImpact} />

        {/* Debts */}
        <DebtsSection data={data} />

        {/* Contributions */}
        <ContributionsSection data={data} currentSalary={currentSalary} />

        {/* RSU Vesting */}
        <RSUVestingSection data={data} />

        {/* Cash Flow */}
        <CashFlowSection data={data} />

        {/* Footer spacing */}
        <div style={{ marginBottom: 80 }} />
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
