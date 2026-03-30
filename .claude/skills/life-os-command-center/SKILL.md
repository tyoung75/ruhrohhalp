# Life OS Command Center Skill (Updated)

## Purpose
Run a complete daily/weekly command center workflow that fuses calendar, tasks, email, and **live financial intelligence** from `/api/finance/briefing`.

## Data Source Upgrade
- Replaces static portfolio assumptions with real-time Financial OS pulls.
- On each run, call:
  - `GET /api/finance/briefing?user_id=<id>`
  - Header: `x-webhook-secret: $RUHROHHALP_SECRET`

---

## 1) Today at a Glance
Include:
- Top 3 priorities
- Calendar risk/conflict check
- **Financial pulse** (single line): household net worth, total debt, and next RSU vest

## 2) Schedule + Week Ahead
Merge normal schedule context with financial events:
- Debt/payment due dates
- Upcoming RSU vest dates
- Contribution transfer dates

## 3) Execution Stack
Generate:
- Focus block plan
- Admin block plan
- Comms triage
- Recovery block plan

## 4) Financial Command Center

### 4.1 Household Net Worth Dashboard
- Total assets / liabilities / net worth
- Owner split: Tyler, spouse, joint, business
- WoW trend callout if prior snapshot available

### 4.2 Account Summary
- Cash vs investment vs retirement buckets
- Notable account-level anomalies

### 4.3 Portfolio + Market Intelligence
- Top holdings by value
- Concentration warnings
- Suggested de-risk actions when concentration > policy threshold

### 4.4 Debt Tracker
- Balance by debt
- APR ranking
- Payoff projections + payoff dates
- Utilization alerts (especially >30%)

### 4.5 Income + Cash Flow
- Gross/net monthly inflow
- Debt + contribution outflow
- Monthly surplus/deficit
- Immediate correction recommendations if negative

### 4.6 RSU Vesting Timeline
- Next vest and estimated value
- 30-day vest queue
- Pre-vest tax + diversification reminders

### 4.7 Contribution Tracker
- Active contributions by destination
- Annualized totals
- Missing or inactive core contributions (e.g., Roth IRA)

### 4.8 Financial Action Items + Optimization
Generate 3-7 actions with owner + due date:
- High APR acceleration
- Upcoming payment execution
- Utilization reduction
- Vest planning
- Contribution optimization
- Roth IRA reminder
- Low cash reserve warning

## 5) Inbox + Financial Triage
- Cross-reference broker, card, and bank alerts against current debt/holding state.
- Flag anything requiring same-day action.

## 6) Wins Log
Capture wins including:
- Debt milestone hits
- New contribution records
- Net-worth highs

## 7) Strategic Insights
Produce concise signals on:
- Net-worth trajectory
- Debt-free timeline
- RSU diversification pacing
- Supplemental income progress toward quarterly targets

## 8) Monday Weekly Financial Review
Every Monday, produce deep review:
- Week-over-week net worth changes
- Cash-flow actuals vs projection
- Debt payoff movement
- Contribution verification
- 3-5 specific financial tasks for the week

## Output Style
- Start with one-screen executive brief.
- Follow with actionable bullets, owners, and dates.
- End with a "Do this next" block (top 3 actions).
