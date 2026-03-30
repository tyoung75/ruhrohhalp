"use client";

import { useState, useEffect } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import {
  formatCurrency,
  formatDelta,
  calculateRaiseImpact,
  resolveAllContributions,
  projectDebtPayoff,
} from "@/lib/finance";
import type {
  FinancialDashboardData,
  Owner,
  RaiseImpact,
  FinancialAccount,
  FinancialHolding,
} from "@/lib/types/finance";
import { Spinner } from "@/components/primitives";

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
}: {
  data: FinancialDashboardData;
}) {
  const { summary } = data;

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
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
  const currentSalary = parseInt(data.config?.annual_salary ?? "247800", 10);

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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 32 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 24 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
                gridTemplateColumns: "1fr auto auto auto auto",
                gap: 16,
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

  // Sort by vest date
  const sorted = [...pendingVests].sort((a, b) => new Date(a.vestDate).getTime() - new Date(b.vestDate).getTime());

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

            return (
              <div
                key={vest.id}
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
                  {Math.floor(vest.shares)} shares
                </div>
                <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.sans, marginBottom: 8 }}>
                  {vest.symbol}
                </div>
                {vest.estimatedValue && (
                  <div
                    style={{
                      color: isUpcoming ? C.gold : C.cream,
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: C.mono,
                    }}
                  >
                    {formatCurrency(vest.estimatedValue)}
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

function CashFlowSection({ data }: { data: FinancialDashboardData }) {
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 32 }}>
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
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [data, setData] = useState<FinancialDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newSalary, setNewSalary] = useState(0);
  const [raiseImpact, setRaiseImpact] = useState<RaiseImpact | null>(null);

  const currentSalary = data ? parseInt(data.config?.annual_salary ?? "247800", 10) : 247800;

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await api<FinancialDashboardData>("/api/finance");
        setData(result);
        setNewSalary(parseInt(result.config?.annual_salary ?? "247800", 10));
      } catch (err) {
        console.error("Failed to load financial data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

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
    <div style={{ background: C.bg, minHeight: "100vh", padding: "40px 60px", fontFamily: C.sans }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: C.serif,
            fontSize: 44,
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

        {/* Net Worth Banner */}
        <NetWorthBanner data={data} />

        {/* Two-Column Accounts Layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginBottom: 40 }}>
          <AccountsSection data={data} owner="tyler" title="Tyler's Accounts" />
          <div>
            <AccountsSection data={data} owner="spouse" title="Wife's Accounts" />
            <div style={{ marginTop: 40 }}>
              <AccountsSection data={data} owner="business_only" title="Business" />
            </div>
          </div>
        </div>

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
      `}</style>
    </div>
  );
}
