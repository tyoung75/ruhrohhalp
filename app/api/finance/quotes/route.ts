import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import YahooFinance from "yahoo-finance2";

/**
 * GET /api/finance/quotes?symbols=AAPL,MSFT,GOOGL
 *
 * Fetches real-time stock quotes via yahoo-finance2.
 * Returns current price, change, change %, and market state for each symbol.
 */

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  marketState: string;
  name: string;
  quoteType: string;
  currency: string;
}

// Simple in-memory cache (15s TTL)
let cache: { data: { quotes: StockQuote[]; fetchedAt: string }; key: string; ts: number } | null = null;
const CACHE_TTL = 15_000;

// Crypto symbols need -USD suffix for Yahoo
const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "AVAX", "DOT", "MATIC", "LINK", "UNI", "SHIB"]);

function toYahooSymbol(s: string): string {
  return CRYPTO_SYMBOLS.has(s) ? `${s}-USD` : s;
}

function fromYahooSymbol(s: string): string {
  return s.endsWith("-USD") && CRYPTO_SYMBOLS.has(s.replace("-USD", ""))
    ? s.replace("-USD", "")
    : s;
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
    .filter((s) => Boolean(s) && s !== "CASH");

  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [], fetchedAt: new Date().toISOString() });
  }

  if (symbols.length > 50) {
    return NextResponse.json({ error: "Maximum 50 symbols per request" }, { status: 400 });
  }

  const cacheKey = symbols.sort().join(",");
  if (cache && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const yahooFinance = new YahooFinance();
    const yahooSymbols = symbols.map(toYahooSymbol);

    const results = await yahooFinance.quote(yahooSymbols, { return: "array" });

    const quotes: StockQuote[] = (Array.isArray(results) ? results : [results])
      .filter((q) => q && q.regularMarketPrice != null)
      .map((q) => ({
        symbol: fromYahooSymbol(q.symbol ?? ""),
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        previousClose: q.regularMarketPreviousClose ?? 0,
        open: q.regularMarketOpen ?? 0,
        dayHigh: q.regularMarketDayHigh ?? 0,
        dayLow: q.regularMarketDayLow ?? 0,
        volume: q.regularMarketVolume ?? 0,
        marketState: q.marketState ?? "CLOSED",
        name: q.shortName ?? q.longName ?? fromYahooSymbol(q.symbol ?? ""),
        quoteType: q.quoteType ?? "EQUITY",
        currency: q.currency ?? "USD",
      }));

    const responseData = { quotes, fetchedAt: new Date().toISOString() };
    cache = { data: responseData, key: cacheKey, ts: Date.now() };

    return NextResponse.json(responseData);
  } catch (err) {
    console.error("Yahoo Finance fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch stock quotes" },
      { status: 502 }
    );
  }
}
