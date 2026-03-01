/**
 * Axiom Metabolic — Webhook Registration Script
 *
 * Run this ONCE after deploying to production (Oxygen or Vercel) to register
 * the Shopify orders/paid webhook pointing to your live domain.
 *
 * Usage:
 *   SHOPIFY_ADMIN_API_TOKEN=shpat_... PRODUCTION_URL=https://your-domain.com npx tsx scripts/register-webhooks.ts
 */

const STORE_DOMAIN = "axiom-metabolic.myshopify.com";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN ?? "YOUR_SHOPIFY_ADMIN_API_TOKEN";
const PRODUCTION_URL = process.env.PRODUCTION_URL ?? "https://axiom-metabolic.com";
const API_VERSION = "2025-01";

const WEBHOOKS = [
  {
    topic: "ORDERS_PAID",
    path: "/api/webhooks/orders",
    description: "Triggers drop-ship vendor notification + Klaviyo SMS on payment",
  },
  {
    topic: "ORDERS_FULFILLED",
    path: "/api/webhooks/orders",
    description: "Triggers Klaviyo fulfillment SMS to customer",
  },
];

async function registerWebhook(topic: string, callbackUrl: string) {
  const mutation = `
    mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $url: URL!) {
      webhookSubscriptionCreate(
        topic: $topic
        webhookSubscription: { callbackUrl: $url, format: JSON }
      ) {
        webhookSubscription { id topic callbackUrl }
        userErrors { field message }
      }
    }
  `;

  const response = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ query: mutation, variables: { topic, url: callbackUrl } }),
    }
  );

  const data = await response.json() as {
    data: {
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string; topic: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    };
  };

  const result = data.data.webhookSubscriptionCreate;
  if (result.userErrors.length > 0) {
    console.error(`❌ ${topic}: ${result.userErrors.map((e) => e.message).join(", ")}`);
  } else {
    console.log(`✅ ${topic} → ${callbackUrl} (ID: ${result.webhookSubscription?.id})`);
  }
}

async function main() {
  console.log(`\nRegistering webhooks for ${STORE_DOMAIN}`);
  console.log(`Production URL: ${PRODUCTION_URL}\n`);

  for (const webhook of WEBHOOKS) {
    const callbackUrl = `${PRODUCTION_URL}${webhook.path}`;
    console.log(`Registering ${webhook.topic}...`);
    await registerWebhook(webhook.topic, callbackUrl);
  }

  console.log("\nDone! Verify webhooks at:");
  console.log(`https://admin.shopify.com/store/axiom-metabolic/settings/notifications\n`);
}

main().catch(console.error);
