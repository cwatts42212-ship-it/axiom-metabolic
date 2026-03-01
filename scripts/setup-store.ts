/**
 * Axiom Metabolic — Store Setup Script
 *
 * Run this ONCE after importing products to configure:
 *  1. All physical products → inventory policy: CONTINUE (zero stock, always purchasable)
 *  2. All physical products → inventory quantity: 0
 *  3. Coaching tier products → created as DRAFT, not tracked
 *  4. Shopify webhooks → registered for orders/paid
 *
 * Usage:
 *   SHOPIFY_ADMIN_API_TOKEN=shpat_... PRODUCTION_URL=https://your-domain.com npx tsx scripts/setup-store.ts
 */

const STORE_DOMAIN = "axiom-metabolic.myshopify.com";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN ?? "YOUR_SHOPIFY_ADMIN_API_TOKEN";
const PRODUCTION_URL = process.env.PRODUCTION_URL ?? "";
const API_VERSION = "2025-01";

async function shopifyGraphQL(query: string, variables = {}) {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function shopifyREST(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Step 1: Configure all product variants to CONTINUE inventory policy ──────

async function configureInventoryPolicies() {
  console.log("\n📦 Configuring inventory policies...");
  let cursor: string | null = null;
  let totalUpdated = 0;

  do {
    const data = await shopifyGraphQL(`
      query GetProducts($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            productType
            variants(first: 10) {
              nodes { id inventoryPolicy inventoryItem { id tracked } }
            }
          }
        }
      }
    `, { cursor });

    const products = data?.data?.products?.nodes ?? [];

    for (const product of products) {
      const isDigital = product.productType?.toLowerCase().includes("coaching");

      for (const variant of product.variants.nodes) {
        if (isDigital) {
          // Digital: disable inventory tracking
          await shopifyGraphQL(`
            mutation UpdateInventoryItem($id: ID!, $input: InventoryItemUpdateInput!) {
              inventoryItemUpdate(id: $id, input: $input) {
                inventoryItem { id tracked }
                userErrors { message }
              }
            }
          `, { id: variant.inventoryItem.id, input: { tracked: false } });
        } else {
          // Physical: set CONTINUE policy (allow purchase even at 0 stock)
          await shopifyGraphQL(`
            mutation SetContinuePolicy($id: ID!) {
              productVariantUpdate(input: { id: $id, inventoryPolicy: CONTINUE }) {
                productVariant { id inventoryPolicy }
                userErrors { message }
              }
            }
          `, { id: variant.id });
        }
        totalUpdated++;
      }
    }

    cursor = data?.data?.products?.pageInfo?.hasNextPage
      ? data.data.products.pageInfo.endCursor
      : null;
  } while (cursor);

  console.log(`  ✅ Updated ${totalUpdated} variants`);
}

// ── Step 2: Create coaching tier products ────────────────────────────────────

const COACHING_PRODUCTS = [
  {
    title: "Axiom Metabolic — AI Coach (Monthly)",
    handle: "coaching-ai-only-monthly",
    description: "24/7 AI-powered weight loss coaching with personalized protocol support, biometric tracking, and smart SMS check-ins.",
    price: "97.00",
    sku: "COACHING-AI-ONLY",
    tier: "ai-only",
  },
  {
    title: "Axiom Metabolic — Bi-Weekly Zoom Coaching (Monthly)",
    handle: "coaching-biweekly-zoom-monthly",
    description: "Everything in AI Coach plus 2 live Zoom sessions per month with your human coach for deeper accountability.",
    price: "147.00",
    sku: "COACHING-BIWEEKLY-ZOOM",
    tier: "biweekly-zoom",
  },
  {
    title: "Axiom Metabolic — Weekly Zoom Coaching (Monthly)",
    handle: "coaching-weekly-zoom-monthly",
    description: "The elite coaching experience: weekly Zoom sessions, direct coach messaging, and fully customized protocol adjustments.",
    price: "197.00",
    sku: "COACHING-WEEKLY-ZOOM",
    tier: "weekly-zoom",
  },
];

async function createCoachingProducts() {
  console.log("\n🎯 Creating coaching tier products...");

  for (const product of COACHING_PRODUCTS) {
    // Check if already exists
    const existing = await shopifyGraphQL(`
      query { productByHandle(handle: "${product.handle}") { id title } }
    `);

    if (existing?.data?.productByHandle?.id) {
      console.log(`  ⏭️  ${product.title} — already exists`);
      continue;
    }

    const result = await shopifyGraphQL(`
      mutation CreateProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product { id handle variants(first: 1) { nodes { id } } }
          userErrors { field message }
        }
      }
    `, {
      input: {
        title: product.title,
        handle: product.handle,
        descriptionHtml: product.description,
        productType: "Coaching Subscription",
        vendor: "Axiom Metabolic",
        tags: ["coaching-tier", "subscription", product.tier],
        status: "DRAFT",
        variants: [{
          price: product.price,
          sku: product.sku,
          inventoryPolicy: "CONTINUE",
          requiresShipping: false,
          taxable: false,
        }],
      },
    });

    const errors = result?.data?.productCreate?.userErrors;
    if (errors?.length) {
      console.error(`  ❌ ${product.title}: ${errors.map((e: { message: string }) => e.message).join(", ")}`);
    } else {
      const variantId = result?.data?.productCreate?.product?.variants?.nodes?.[0]?.id;
      console.log(`  ✅ ${product.title} (Variant: ${variantId})`);
    }
  }
}

// ── Step 3: Register webhooks ─────────────────────────────────────────────────

async function registerWebhooks() {
  if (!PRODUCTION_URL) {
    console.log("\n⚠️  PRODUCTION_URL not set — skipping webhook registration");
    console.log("   Set PRODUCTION_URL=https://your-domain.com and re-run to register webhooks");
    return;
  }

  console.log("\n🔗 Registering webhooks...");

  const webhooks = [
    { topic: "ORDERS_PAID", path: "/api/webhooks/orders" },
    { topic: "ORDERS_FULFILLED", path: "/api/webhooks/orders" },
  ];

  for (const webhook of webhooks) {
    const callbackUrl = `${PRODUCTION_URL}${webhook.path}`;
    const result = await shopifyGraphQL(`
      mutation {
        webhookSubscriptionCreate(
          topic: ${webhook.topic}
          webhookSubscription: { callbackUrl: "${callbackUrl}", format: JSON }
        ) {
          webhookSubscription { id topic }
          userErrors { field message }
        }
      }
    `);

    const errors = result?.data?.webhookSubscriptionCreate?.userErrors;
    if (errors?.length) {
      console.error(`  ❌ ${webhook.topic}: ${errors.map((e: { message: string }) => e.message).join(", ")}`);
    } else {
      const id = result?.data?.webhookSubscriptionCreate?.webhookSubscription?.id;
      console.log(`  ✅ ${webhook.topic} → ${callbackUrl} (${id})`);
    }
  }
}

// ── Step 4: Verify store connection ──────────────────────────────────────────

async function verifyStore() {
  const result = await shopifyREST("shop.json");
  const shop = result?.shop;
  if (!shop) throw new Error("Could not connect to store");
  console.log(`\n✅ Connected to: ${shop.name} (${shop.myshopify_domain})`);
  console.log(`   Owner: ${shop.shop_owner} | Currency: ${shop.currency}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Axiom Metabolic — Store Setup\n" + "=".repeat(40));

  await verifyStore();
  await createCoachingProducts();
  await configureInventoryPolicies();
  await registerWebhooks();

  console.log("\n" + "=".repeat(40));
  console.log("✅ Store setup complete!");
  console.log("\nNext steps:");
  console.log("  1. Upload your product CSV via Shopify Admin");
  console.log("  2. Run this script again to configure inventory on new products");
  console.log("  3. Set PRODUCTION_URL and run again to register webhooks");
  console.log("  4. Review and publish coaching products in Shopify Admin");
  console.log("  5. Set VENDOR_EMAIL or VENDOR_WEBHOOK_URL in .env");
}

main().catch(console.error);
