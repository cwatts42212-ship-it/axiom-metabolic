# Axiom Metabolic — RPA Webhook Payload Schema
## For Zapier Bridge → Ideal Protein Portal Entry

This document defines the exact JSON payload sent by Shopify when an order is paid (`orders/paid` event).
Use these key names to map fields in your Zapier workflow.

---

## Trigger: `orders/paid`
**Fires when:** A customer completes checkout and payment is confirmed.

---

## Full JSON Schema

```json
{
  "id": 820982911946154508,
  "order_number": 1001,
  "financial_status": "paid",
  "fulfillment_status": null,
  "created_at": "2026-03-01T12:00:00-06:00",
  "processed_at": "2026-03-01T12:00:00-06:00",
  "total_price": "199.00",
  "subtotal_price": "199.00",
  "currency": "USD",
  "note": null,
  "tags": "",

  "customer": {
    "id": 115310627314723954,
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane.smith@example.com",
    "phone": "+13125551234"
  },

  "shipping_address": {
    "first_name": "Jane",
    "last_name": "Smith",
    "address1": "123 Main Street",
    "address2": "Apt 4B",
    "city": "Chicago",
    "province": "Illinois",
    "province_code": "IL",
    "zip": "60601",
    "country": "United States",
    "country_code": "US",
    "phone": "+13125551234"
  },

  "billing_address": {
    "first_name": "Jane",
    "last_name": "Smith",
    "address1": "123 Main Street",
    "city": "Chicago",
    "province": "Illinois",
    "province_code": "IL",
    "zip": "60601",
    "country": "United States",
    "country_code": "US"
  },

  "line_items": [
    {
      "id": 866550311766439020,
      "title": "Ideal Protein Chicken Soup",
      "name": "Ideal Protein Chicken Soup",
      "variant_title": "Box of 7",
      "sku": "IP-SOUP-CHICKEN-7",
      "vendor": "Ideal Protein",
      "quantity": 2,
      "price": "38.00",
      "total_discount": "0.00",
      "fulfillment_status": null,
      "requires_shipping": true,
      "product_id": 632910392,
      "variant_id": 808950810
    },
    {
      "id": 141249953214522974,
      "title": "Axiom Metabolic — AI Coach (Tier 1)",
      "name": "Axiom Metabolic — AI Coach (Tier 1)",
      "variant_title": null,
      "sku": "AXIOM-TIER-1-AI",
      "vendor": "Axiom Metabolic",
      "quantity": 1,
      "price": "99.00",
      "total_discount": "0.00",
      "fulfillment_status": null,
      "requires_shipping": false,
      "product_id": 788032119674292922,
      "variant_id": 642667041472713922
    }
  ]
}
```

---

## RPA Field Mapping for Zapier → Ideal Protein Portal

| Your RPA Field | Shopify JSON Key Path | Example Value |
|:---|:---|:---|
| **Customer_Name** | `customer.first_name` + `customer.last_name` | `Jane Smith` |
| **Customer_Email** | `customer.email` | `jane.smith@example.com` |
| **Customer_Phone** | `customer.phone` | `+13125551234` |
| **Shipping_Address_Line1** | `shipping_address.address1` | `123 Main Street` |
| **Shipping_Address_Line2** | `shipping_address.address2` | `Apt 4B` |
| **Shipping_City** | `shipping_address.city` | `Chicago` |
| **Shipping_State** | `shipping_address.province_code` | `IL` |
| **Shipping_Zip** | `shipping_address.zip` | `60601` |
| **Line_Items** | `line_items` (array) | See array above |
| **Product_SKU** | `line_items[n].sku` | `IP-SOUP-CHICKEN-7` |
| **Product_Name** | `line_items[n].title` | `Ideal Protein Chicken Soup` |
| **Product_Quantity** | `line_items[n].quantity` | `2` |
| **Order_Number** | `order_number` | `1001` |
| **Order_Total** | `total_price` | `199.00` |

---

## Zapier Filter Logic (Important)

Not all line items should be sent to Ideal Protein. Use a **Zapier Filter** step:

- **Condition:** `line_items[n].vendor` **equals** `Ideal Protein`
- **AND:** `line_items[n].requires_shipping` **equals** `true`

This ensures coaching tier products (digital, vendor = "Axiom Metabolic") are excluded from the vendor order.

---

## Webhook Registration Note

Shopify blocks webhooks to `.myshopify.dev` domains (Oxygen preview URLs).
**Once you connect a custom domain** (e.g., `app.axiommetabolic.com`) to your Oxygen storefront,
run this command to register the production webhook:

```bash
curl -X POST "https://axiom-metabolic.myshopify.com/admin/api/2024-01/webhooks.json" \
  -H "X-Shopify-Access-Token: YOUR_SHOPIFY_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "topic": "orders/paid",
      "address": "https://YOUR_CUSTOM_DOMAIN/api/webhooks/orders",
      "format": "json"
    }
  }'
```

**Interim solution (active now):** Shopify's built-in order notification email is configured to
send a full order summary to `usorders@idealprotein.com` on every paid order.
Navigate to: Shopify Admin → Settings → Notifications → Orders → New order → add vendor email.

