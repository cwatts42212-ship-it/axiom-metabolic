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


import type { ActionFunctionArgs } from 'react-router';
import { notifyVendor, parseShopifyOrder } from "~/lib/fulfillment/dropship";
import { triggerOrderFulfilled } from "~/lib/klaviyo/sms";
// Web Crypto API helper for Cloudflare Workers / Oxygen runtime
async function verifyShopifyHmac(
  secret: string,
  body: string,
  hmacHeader: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return computed === hmacHeader;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Verify Shopify HMAC signature using Web Crypto API
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const rawBody = await request.text();

  if (hmacHeader && process.env.SHOPIFY_WEBHOOK_SECRET) {
    const isValid = await verifyShopifyHmac(
      process.env.SHOPIFY_WEBHOOK_SECRET,
      rawBody,
      hmacHeader
    );
    if (!isValid) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
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
      return Response.json({ success: true });
    } catch (err) {
      console.error("[WEBHOOK] Order processing error:", err);
      return Response.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Acknowledge other topics
  return Response.json({ received: true });
}
