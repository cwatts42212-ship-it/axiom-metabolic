/**
 * Axiom Metabolic — Order Webhook Handler
 * Route: /api/webhooks/orders
 *
 * Accepts orders from two authenticated sources:
 *  1. Shopify native webhook (X-Shopify-Hmac-Sha256 header)
 *  2. Zapier RPA Bridge (Authorization: Bearer <ZAPIER_WEBHOOK_SECRET>)
 *
 * On every authenticated order payload:
 *  1. Parses the order
 *  2. Notifies the drop-ship vendor (via RPA bridge log / future email)
 *  3. Sends Klaviyo order confirmation SMS
 */

import type { ActionFunctionArgs } from 'react-router';
import { notifyVendor, parseShopifyOrder, parseZapierOrder } from "~/lib/fulfillment/dropship";
import { triggerOrderFulfilled } from "~/lib/klaviyo/sms";

// ---------------------------------------------------------------------------
// Web Crypto API helper for Cloudflare Workers / Oxygen runtime
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Route action
// ---------------------------------------------------------------------------
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const authHeader = request.headers.get("Authorization");
  const zapierSecret = process.env.ZAPIER_WEBHOOK_SECRET;
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  let isAuthenticated = false;
  let source: "shopify" | "zapier" = "shopify";

  // --- Path 1: Shopify native HMAC verification ---
  if (hmacHeader && shopifySecret) {
    const isValid = await verifyShopifyHmac(shopifySecret, rawBody, hmacHeader);
    if (isValid) {
      isAuthenticated = true;
      source = "shopify";
    }
  }

  // --- Path 2: Zapier Bearer token verification ---
  if (!isAuthenticated && authHeader && zapierSecret) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === zapierSecret) {
      isAuthenticated = true;
      source = "zapier";
    }
  }

  // --- Reject unauthenticated requests ---
  // Allow through if neither secret is configured (dev / first-run mode)
  const secretsConfigured = !!(hmacHeader || authHeader) && !!(shopifySecret || zapierSecret);
  if (secretsConfigured && !isAuthenticated) {
    console.warn("[WEBHOOK] Rejected unauthorized request");
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  // --- Parse payload ---
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Determine topic: Shopify sends X-Shopify-Topic header; Zapier payloads
  // always represent a paid order so we default to "orders/paid".
  const topic = request.headers.get("X-Shopify-Topic") ?? "orders/paid";

  if (topic === "orders/paid") {
    try {
      // Parse order from the appropriate schema
      const order = source === "zapier"
        ? parseZapierOrder(payload)
        : parseShopifyOrder(payload);

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

      console.log(`[WEBHOOK] Order ${order.order_number} processed (source: ${source})`);
      return Response.json({ success: true, source });
    } catch (err) {
      console.error("[WEBHOOK] Order processing error:", err);
      return Response.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Acknowledge other topics
  return Response.json({ received: true });
}
