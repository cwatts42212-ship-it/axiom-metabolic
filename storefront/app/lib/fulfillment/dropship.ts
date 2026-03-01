/**
 * Axiom Metabolic — Drop-Ship Fulfillment Automation
 * Triggered on order payment. Sends vendor notification and manages zero-inventory flow.
 */

import { shopifyAdminRest } from "../shopify/admin-client";

export interface OrderLineItem {
  product_id: number;
  variant_id: number;
  title: string;
  variant_title: string;
  quantity: number;
  sku: string;
  price: string;
}

export interface DropShipOrder {
  shopify_order_id: number;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  shipping_address: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone?: string;
  };
  line_items: OrderLineItem[];
  total_price: string;
  created_at: string;
}

/** Send drop-ship notification to vendor via webhook or email */
export async function notifyVendor(order: DropShipOrder): Promise<void> {
  const vendorWebhookUrl = process.env.VENDOR_WEBHOOK_URL;
  const vendorEmail = process.env.VENDOR_EMAIL;

  const payload = {
    source: "Axiom Metabolic",
    event: "new_order",
    order,
    instructions: "Please fulfill and ship directly to customer. Zero inventory on our end.",
    timestamp: new Date().toISOString(),
  };

  // Method 1: Webhook POST (if configured)
  if (vendorWebhookUrl) {
    const response = await fetch(vendorWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(`Vendor webhook failed: ${response.status}`);
    }
  }

  // Method 2: Email via Shopify (always fires as backup)
  if (vendorEmail) {
    await sendVendorEmailViaShopify(order, vendorEmail);
  }
}

/** Send vendor notification email using Shopify's email system */
async function sendVendorEmailViaShopify(
  order: DropShipOrder,
  vendorEmail: string
): Promise<void> {
  // Build a plain-text order summary for vendor
  const itemsList = order.line_items
    .map((item) => `  - ${item.title} (${item.variant_title}) x${item.quantity} — SKU: ${item.sku}`)
    .join("\n");

  const emailBody = `
NEW DROP-SHIP ORDER — Axiom Metabolic
=====================================
Order #: ${order.order_number}
Date: ${new Date(order.created_at).toLocaleString()}

SHIP TO:
${order.shipping_address.name}
${order.shipping_address.address1}
${order.shipping_address.address2 ? order.shipping_address.address2 + "\n" : ""}${order.shipping_address.city}, ${order.shipping_address.province} ${order.shipping_address.zip}
${order.shipping_address.country}
Phone: ${order.shipping_address.phone ?? "N/A"}

ITEMS TO FULFILL:
${itemsList}

ORDER TOTAL: $${order.total_price}

Customer Email: ${order.customer_email}

Please fulfill and ship directly to the customer address above.
Do NOT include any Axiom Metabolic pricing or invoices in the package.

Questions? Reply to this email.
  `.trim();

  console.log(`[VENDOR EMAIL] To: ${vendorEmail}\n${emailBody}`);
  // In production, integrate with SendGrid/Mailgun or use Shopify Email API
}

/** Mark a Shopify order as fulfilled (after vendor confirms shipment) */
export async function markOrderFulfilled(
  orderId: number,
  trackingNumber?: string,
  trackingCompany?: string
): Promise<void> {
  // Get fulfillment order ID
  const fulfillmentOrders = await shopifyAdminRest<{
    fulfillment_orders: { id: number }[];
  }>(`orders/${orderId}/fulfillment_orders.json`);

  if (!fulfillmentOrders.fulfillment_orders?.length) return;

  const fulfillmentOrderId = fulfillmentOrders.fulfillment_orders[0].id;

  await shopifyAdminRest(`fulfillments.json`, {
    method: "POST",
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: [
          { fulfillment_order_id: fulfillmentOrderId },
        ],
        tracking_info: trackingNumber
          ? {
              number: trackingNumber,
              company: trackingCompany ?? "Other",
            }
          : undefined,
        notify_customer: true,
      },
    }),
  });
}

/** Parse a Shopify order webhook payload into our DropShipOrder format */
export function parseShopifyOrder(webhookPayload: Record<string, unknown>): DropShipOrder {
  const shipping = webhookPayload.shipping_address as Record<string, string>;
  const lineItems = webhookPayload.line_items as Record<string, unknown>[];

  return {
    shopify_order_id: webhookPayload.id as number,
    order_number: String(webhookPayload.order_number),
    customer_name: `${webhookPayload.customer ? (webhookPayload.customer as Record<string, string>).first_name : ""} ${webhookPayload.customer ? (webhookPayload.customer as Record<string, string>).last_name : ""}`.trim(),
    customer_email: webhookPayload.email as string,
    customer_phone: webhookPayload.phone as string | undefined,
    shipping_address: {
      name: shipping?.name ?? "",
      address1: shipping?.address1 ?? "",
      address2: shipping?.address2,
      city: shipping?.city ?? "",
      province: shipping?.province ?? "",
      zip: shipping?.zip ?? "",
      country: shipping?.country ?? "",
      phone: shipping?.phone,
    },
    line_items: lineItems.map((item) => ({
      product_id: item.product_id as number,
      variant_id: item.variant_id as number,
      title: item.title as string,
      variant_title: item.variant_title as string,
      quantity: item.quantity as number,
      sku: item.sku as string,
      price: item.price as string,
    })),
    total_price: webhookPayload.total_price as string,
    created_at: webhookPayload.created_at as string,
  };
}
