/**
 * Axiom Metabolic — Drop-Ship Fulfillment Automation
 * Triggered on order payment. Fires RPA webhook payload to Zapier bridge.
 * Vendor email notifications have been intentionally removed — all fulfillment
 * is handled exclusively via the Zapier RPA Bridge.
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
  vendor: string;
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
    province_code: string;
    zip: string;
    country: string;
    country_code: string;
    phone?: string;
  };
  line_items: OrderLineItem[];
  ideal_protein_items: OrderLineItem[]; // Only IP physical items for RPA
  total_price: string;
  created_at: string;
}

/**
 * Fire the RPA webhook to the Zapier bridge.
 * Only sends Ideal Protein line items — coaching tier (digital) items are excluded.
 * This is the SOLE fulfillment notification method. No email fallback.
 */
export async function notifyVendor(order: DropShipOrder): Promise<void> {
  // Only proceed if there are Ideal Protein physical items
  if (!order.ideal_protein_items || order.ideal_protein_items.length === 0) {
    console.log(`[RPA Bridge] Order #${order.order_number} has no Ideal Protein items — skipping vendor notification.`);
    return;
  }

  const rpaWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;

  if (!rpaWebhookUrl) {
    console.error("[RPA Bridge] ZAPIER_WEBHOOK_URL is not configured. Set it in your environment variables.");
    return;
  }

  // RPA payload — matches the JSON schema provided to Zapier
  const rpaPayload = {
    source: "Axiom Metabolic",
    event: "new_order",
    timestamp: new Date().toISOString(),
    order: {
      shopify_order_id: order.shopify_order_id,
      order_number: order.order_number,
      created_at: order.created_at,
      total_price: order.total_price,
    },
    // RPA Schema fields — exact key names for Zapier mapping
    Customer_Name: order.customer_name,
    Customer_Email: order.customer_email,
    Customer_Phone: order.customer_phone ?? "",
    Shipping_Address: {
      name: order.shipping_address.name,
      address1: order.shipping_address.address1,
      address2: order.shipping_address.address2 ?? "",
      city: order.shipping_address.city,
      province: order.shipping_address.province,
      province_code: order.shipping_address.province_code,
      zip: order.shipping_address.zip,
      country: order.shipping_address.country,
      country_code: order.shipping_address.country_code,
      phone: order.shipping_address.phone ?? "",
    },
    Line_Items: order.ideal_protein_items.map((item) => ({
      title: item.title,
      variant_title: item.variant_title,
      quantity: item.quantity,
      Product_SKU: item.sku,
      price: item.price,
      vendor: item.vendor,
    })),
  };

  const response = await fetch(rpaWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpaPayload),
  });

  if (response.ok) {
    console.log(`[RPA Bridge] ✓ Order #${order.order_number} sent to Zapier — ${order.ideal_protein_items.length} IP items`);
  } else {
    const errorText = await response.text();
    console.error(`[RPA Bridge] ✗ Webhook failed for Order #${order.order_number}: ${response.status} — ${errorText}`);
    throw new Error(`RPA webhook failed: ${response.status}`);
  }
}

/** Mark a Shopify order as fulfilled (after vendor confirms shipment) */
export async function markOrderFulfilled(
  orderId: number,
  trackingNumber?: string,
  trackingCompany?: string
): Promise<void> {
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

/**
 * Parse a Shopify order webhook payload into our DropShipOrder format.
 * Automatically separates Ideal Protein items from coaching/digital items.
 */
export function parseShopifyOrder(webhookPayload: Record<string, unknown>): DropShipOrder {
  const shipping = webhookPayload.shipping_address as Record<string, string>;
  const lineItems = webhookPayload.line_items as Record<string, unknown>[];
  const customer = webhookPayload.customer as Record<string, string> | undefined;

  const allLineItems: OrderLineItem[] = lineItems.map((item) => ({
    product_id: item.product_id as number,
    variant_id: item.variant_id as number,
    title: item.title as string,
    variant_title: item.variant_title as string,
    quantity: item.quantity as number,
    sku: item.sku as string,
    price: item.price as string,
    vendor: item.vendor as string,
  }));

  // Filter to only physical Ideal Protein items for RPA
  const idealProteinItems = allLineItems.filter(
    (item) => item.vendor === "Ideal Protein"
  );

  return {
    shopify_order_id: webhookPayload.id as number,
    order_number: String(webhookPayload.order_number),
    customer_name: `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim(),
    customer_email: webhookPayload.email as string,
    customer_phone: webhookPayload.phone as string | undefined,
    shipping_address: {
      name: shipping?.name ?? "",
      address1: shipping?.address1 ?? "",
      address2: shipping?.address2,
      city: shipping?.city ?? "",
      province: shipping?.province ?? "",
      province_code: shipping?.province_code ?? "",
      zip: shipping?.zip ?? "",
      country: shipping?.country ?? "",
      country_code: shipping?.country_code ?? "",
      phone: shipping?.phone,
    },
    line_items: allLineItems,
    ideal_protein_items: idealProteinItems,
    total_price: webhookPayload.total_price as string,
    created_at: webhookPayload.created_at as string,
  };
}

/**
 * Parse a Zapier RPA Bridge payload into our DropShipOrder format.
 *
 * Zapier sends the flat JSON schema defined in RPA_WEBHOOK_SCHEMA.md:
 *  {
 *    customer_first_name, customer_last_name,
 *    shipping_address_1, shipping_address_city,
 *    shipping_address_province, shipping_address_zip,
 *    line_items, product_sku
 *  }
 *
 * All items in a Zapier payload are Ideal Protein items (the Zap filter
 * already ensures only IP vendor orders reach this endpoint).
 */
export function parseZapierOrder(payload: Record<string, unknown>): DropShipOrder {
  const firstName = (payload.customer_first_name as string) ?? "";
  const lastName = (payload.customer_last_name as string) ?? "";
  const customerName = `${firstName} ${lastName}`.trim();

  // Line items may arrive as a JSON string or already-parsed array
  let lineItemsRaw: Record<string, unknown>[] = [];
  if (typeof payload.line_items === "string") {
    try {
      lineItemsRaw = JSON.parse(payload.line_items) as Record<string, unknown>[];
    } catch {
      lineItemsRaw = [];
    }
  } else if (Array.isArray(payload.line_items)) {
    lineItemsRaw = payload.line_items as Record<string, unknown>[];
  }

  const allLineItems: OrderLineItem[] = lineItemsRaw.map((item) => ({
    product_id: (item.product_id as number) ?? 0,
    variant_id: (item.variant_id as number) ?? 0,
    title: (item.title as string) ?? (item.name as string) ?? "",
    variant_title: (item.variant_title as string) ?? "",
    quantity: (item.quantity as number) ?? 1,
    sku: (item.sku as string) ?? (payload.product_sku as string) ?? "",
    price: (item.price as string) ?? "0.00",
    vendor: "Ideal Protein",
  }));

  // All Zapier orders are Ideal Protein (filter is applied in the Zap)
  const idealProteinItems = allLineItems.length > 0
    ? allLineItems
    : [{
        product_id: 0,
        variant_id: 0,
        title: "Ideal Protein Product",
        variant_title: "",
        quantity: 1,
        sku: (payload.product_sku as string) ?? "",
        price: "0.00",
        vendor: "Ideal Protein",
      }];

  return {
    shopify_order_id: (payload.shopify_order_id as number) ?? 0,
    order_number: (payload.order_number as string) ?? `ZAP-${Date.now()}`,
    customer_name: customerName,
    customer_email: (payload.customer_email as string) ?? "",
    customer_phone: payload.customer_phone as string | undefined,
    shipping_address: {
      name: customerName,
      address1: (payload.shipping_address_1 as string) ?? "",
      address2: payload.shipping_address_2 as string | undefined,
      city: (payload.shipping_address_city as string) ?? "",
      province: (payload.shipping_address_province as string) ?? "",
      province_code: (payload.shipping_address_province as string) ?? "",
      zip: (payload.shipping_address_zip as string) ?? "",
      country: (payload.shipping_address_country as string) ?? "US",
      country_code: "US",
      phone: payload.customer_phone as string | undefined,
    },
    line_items: allLineItems,
    ideal_protein_items: idealProteinItems,
    total_price: (payload.total_price as string) ?? "0.00",
    created_at: new Date().toISOString(),
  };
}
