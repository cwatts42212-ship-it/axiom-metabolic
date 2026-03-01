/**
 * Axiom Metabolic — Shopify Order Webhook Handler
 * Route: /api/webhooks/orders
 *
 * Handles Shopify's orders/paid webhook.
 * On every successful payment:
 *  1. Parses the order
 *  2. Notifies the drop-ship vendor
 *  3. Sends Klaviyo order confirmation SMS
 */

import { json } from "@shopify/hydrogen";
import type { ActionFunctionArgs } from "@shopify/hydrogen";
import { notifyVendor, parseShopifyOrder } from "~/lib/fulfillment/dropship";
import { triggerOrderFulfilled } from "~/lib/klaviyo/sms";
import crypto from "crypto";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Verify Shopify HMAC signature
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const rawBody = await request.text();

  if (hmacHeader && process.env.SHOPIFY_WEBHOOK_SECRET) {
    const hash = crypto
      .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    if (hash !== hmacHeader) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const topic = request.headers.get("X-Shopify-Topic");

  if (topic === "orders/paid") {
    try {
      const order = parseShopifyOrder(payload);

      // 1. Notify vendor for drop-ship fulfillment
      await notifyVendor(order);

      // 2. Send Klaviyo SMS confirmation
      if (order.customer_email) {
        const firstName = order.customer_name.split(" ")[0] ?? "Client";
        await triggerOrderFulfilled(
          order.customer_email,
          order.customer_phone ?? "",
          firstName,
          order.order_number
        ).catch(console.error);
      }

      console.log(`[WEBHOOK] Order ${order.order_number} processed for drop-ship`);
      return json({ success: true });
    } catch (err) {
      console.error("[WEBHOOK] Order processing error:", err);
      return json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Acknowledge other topics
  return json({ received: true });
}
