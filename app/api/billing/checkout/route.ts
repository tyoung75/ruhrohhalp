import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkoutSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { getStripe, PRICE_IDS } from "@/lib/billing/stripe";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const stripe = getStripe();
  const supabase = await createClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    let customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await supabase.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_customer_id: customerId,
          status: "incomplete",
          tier: "free",
        },
        { onConflict: "user_id" },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: PRICE_IDS[parsed.data.tier], quantity: 1 }],
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=cancelled`,
      metadata: {
        userId: user.id,
        tier: parsed.data.tier,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    logError("billing.checkout_failed", error, { userId: user.id });
    return NextResponse.json({ error: "Could not create checkout session" }, { status: 500 });
  }
}
