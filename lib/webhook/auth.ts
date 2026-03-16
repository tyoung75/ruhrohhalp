import { NextResponse } from "next/server";

/**
 * Validate the x-webhook-secret header against WEBHOOK_SECRET env var.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export function validateWebhookSecret(headerValue: string | null): NextResponse | null {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }
  if (!headerValue || headerValue !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
