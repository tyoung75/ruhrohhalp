import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import YahooFinance from "yahoo-finance2";

/**
 * GET /api/finance/quotes/historical?symbols=AAPL,MSFT
 *
 * Fetches historical closing prices for performance metric calculation.
 * Returns prices at key lookback dates: 1d, 1w, 1m, ytd, 1y ago.
 */

export interface HistoricalPriceData {
  symbol: string;
  price1dAgo: number | null;
  price1wAgo: number | null;
  price1mAgo: number | null;
  priceYtdStart: number | null;
  price1yAgo: number | null;
}

// In-memory cache (5 min TTL — historical data doesn't change intraday)
let cache: { data: Record<string, HistoricalPriceData>; key: string; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "AVAX", "DOT", "MATIC", "LINK", "UNI", "SHIB"]);

function toYahooSymbol(s: string): string {
  return CRYPTO_SYMBOLS.has(s) ? `${s}-USD` : s;
}

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().split("T")[0];
}

function getYtdStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

/** Find the closest available close price to a target date */
function findClosestClose(
  data: Array<{ date: Date; close?: number | null }>,
  targetDate: Date
): number | null {
  if (!data || data.length === 0) return null;

  let closest: { date: Date; close?: number | null } | null = null;
  let minDiff = Infinity;

  for (const row of data) {
    const diff = Math.abs(row.date.getTime() - targetDate.getTime());
    if (diff < minDiff && row.close != null) {
      minDiff = diff;
      closest = row;
    }
  }

  // Only use if within 5 trading days (7 calendar days)
  if (closest && minDiff < 7 * 24 * 60 * 60 * 1000) {
    return closest.close ?? null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  if (!symbolsParam) {
    return NextResponse.json({ error: "symbols query parameter is required" }, { status: 400 });
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => Boolean(s) && s !== "CASH" && s !== "FUIPX");

  if (symbols.length === 0) {
    return NextResponse.json({ historical: {} });
  }

  const cacheKey = symbols.sort().join(",");
  if (cache && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ historical: cache.data });
  }

  try {
    const yahooFinance = new YahooFinance();
    const now = new Date();
    const period1 = daysAgo(400); // ~13 months back for YoY

    const results: Record<string, HistoricalPriceData> = {};

    // Fetch in parallel, batched to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const promises = batch.map(async (symbol) => {
        try {
          const yahooSym = toYahooSymbol(symbol);
          const history = await yahooFinance.historical(yahooSym, {
            period1,
            period2: now.toISOString().split("T")[0],
            interval: "1d",
          });

          const target1d = new Date(daysAgo(1));
          const target1w = new Date(daysAgo(7));
          const target1m = new Date(daysAgo(30));
          const targetYtd = new Date(getYtdStart());
          const target1y = new Date(daysAgo(365));

          const data: HistoricalPriceData = {
            symbol,
            price1dAgo: findClosestClose(history, target1d),
            price1wAgo: findClosestClose(history, target1w),
            price1mAgo: findClosestClose(history, target1m),
            priceYtdStart: findClosestClose(history, targetYtd),
            price1yAgo: findClosestClose(history, target1y),
          };

          results[symbol] = data;
        } catch (err) {
          console.warn(`Failed to fetch historical data for ${symbol}:`, err);
          results[symbol] = {
            symbol,
            price1dAgo: null,
            price1wAgo: null,
            price1mAgo: null,
            priceYtdStart: null,
            price1yAgo: null,
          };
        }
      });

      await Promise.all(promises);
    }

    cache = { data: results, key: cacheKey, ts: Date.now() };
    return NextResponse.json({ historical: results });
  } catch (err) {
    console.error("Historical data fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch historical data" },
      { status: 502 }
    );
  }
}
