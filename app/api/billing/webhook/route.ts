import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceToTier } from "@/lib/billing/tier-map";
import { logError, logInfo } from "@/lib/logger";

export async function POST(req: Request) {
  const stripe = getStripe();
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json({ error: "Missing webhook signature config" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    logError("billing.webhook_invalid_signature", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const tier = (session.metadata?.tier as "starter" | "pro" | "byok" | undefined) ?? "free";
      if (userId) {
        await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
            stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : null,
            status: "active",
            tier,
          },
          { onConflict: "user_id" },
        );
        await supabase.from("profiles").update({ active_tier: tier }).eq("id", userId);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price?.id;
      const tier = priceToTier(priceId);
      const customerId = typeof sub.customer === "string" ? sub.customer : null;
      const status = sub.status;
      if (customerId) {
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (subscription?.user_id) {
          await supabase
            .from("subscriptions")
            .update({
              stripe_subscription_id: sub.id,
              stripe_price_id: priceId,
              status,
              tier: status === "active" ? tier : "free",
              current_period_end: (() => {
                const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
                return typeof periodEnd === "number" ? new Date(periodEnd * 1000).toISOString() : null;
              })(),
            })
            .eq("user_id", subscription.user_id);

          await supabase
            .from("profiles")
            .update({ active_tier: status === "active" ? tier : "free" })
            .eq("id", subscription.user_id);
        }
      }
    }

    logInfo("billing.webhook_processed", { type: event.type });
    return NextResponse.json({ received: true });
  } catch (error) {
    logError("billing.webhook_failed", error, { type: event.type });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
