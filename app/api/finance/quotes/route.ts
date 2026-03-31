import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/finance/quotes?symbols=AAPL,MSFT,GOOGL
 *
 * Fetches real-time stock quotes from Yahoo Finance.
 * Returns current price, change, change %, and market state for each symbol.
 */

interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose: number;
  regularMarketOpen: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  marketState: string; // "REGULAR", "PRE", "POST", "CLOSED"
  shortName: string;
  quoteType: string;
  currency: string;
}

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
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "No valid symbols provided" }, { status: 400 });
  }

  if (symbols.length > 50) {
    return NextResponse.json({ error: "Maximum 50 symbols per request" }, { status: 400 });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketState,shortName,quoteType,currency`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      next: { revalidate: 15 }, // Cache for 15 seconds server-side
    });

    if (!res.ok) {
      // Fallback: try the v6 endpoint
      const fallbackUrl = `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symbols.join(",")}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 15 },
      });

      if (!fallbackRes.ok) {
        return NextResponse.json(
          { error: "Failed to fetch quotes from Yahoo Finance" },
          { status: 502 }
        );
      }

      const fallbackData = await fallbackRes.json();
      const quotes = mapQuotes(fallbackData?.quoteResponse?.result ?? []);
      return NextResponse.json({ quotes, fetchedAt: new Date().toISOString() });
    }

    const data = await res.json();
    const quotes = mapQuotes(data?.quoteResponse?.result ?? []);

    return NextResponse.json({
      quotes,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Yahoo Finance fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch stock quotes" },
      { status: 502 }
    );
  }
}

function mapQuotes(results: YahooQuote[]): StockQuote[] {
  return results.map((q) => ({
    symbol: q.symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    previousClose: q.regularMarketPreviousClose ?? 0,
    open: q.regularMarketOpen ?? 0,
    dayHigh: q.regularMarketDayHigh ?? 0,
    dayLow: q.regularMarketDayLow ?? 0,
    volume: q.regularMarketVolume ?? 0,
    marketState: q.marketState ?? "CLOSED",
    name: q.shortName ?? q.symbol,
    quoteType: q.quoteType ?? "EQUITY",
    currency: q.currency ?? "USD",
  }));
}
