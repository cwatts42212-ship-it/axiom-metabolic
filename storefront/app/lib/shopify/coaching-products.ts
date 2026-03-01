/**
 * Axiom Metabolic — Coaching Products Manager
 *
 * Ensures the three coaching tier products exist in Shopify.
 * Called during checkout to get the correct variant ID.
 * Products are created as draft (not published) — admin reviews before publishing.
 *
 * Product structure:
 *  - Title: "Axiom Metabolic — AI Coach (Monthly)"
 *  - Tags: coaching-tier, subscription
 *  - Inventory: 0 (tracked = false, no physical stock)
 *  - Price: per tier
 */

import { shopifyAdminFetch } from "./admin-client";

interface CoachingTier {
  id: string;
  name: string;
  price: number;
  interval: string;
}

interface ShopifyProduct {
  id: string;
  handle: string;
  variants: { nodes: Array<{ id: string }> };
}

const TIER_HANDLES: Record<string, string> = {
  "ai-only": "coaching-ai-only-monthly",
  "biweekly-zoom": "coaching-biweekly-zoom-monthly",
  "weekly-zoom": "coaching-weekly-zoom-monthly",
};

const TIER_TITLES: Record<string, string> = {
  "ai-only": "Axiom Metabolic — AI Coach (Monthly)",
  "biweekly-zoom": "Axiom Metabolic — Bi-Weekly Zoom Coaching (Monthly)",
  "weekly-zoom": "Axiom Metabolic — Weekly Zoom Coaching (Monthly)",
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  "ai-only":
    "24/7 AI-powered weight loss coaching with personalized protocol support, biometric tracking, and smart SMS check-ins.",
  "biweekly-zoom":
    "Everything in AI Coach plus 2 live Zoom sessions per month with your human coach for deeper accountability.",
  "weekly-zoom":
    "The elite coaching experience: weekly Zoom sessions, direct coach messaging, and fully customized protocol adjustments.",
};

/** Cache variant IDs in memory to avoid repeated API calls */
const variantCache: Record<string, string> = {};

/** Get or create a coaching product and return its variant GID */
export async function ensureCoachingProductExists(tier: CoachingTier): Promise<string> {
  if (variantCache[tier.id]) return variantCache[tier.id];

  const handle = TIER_HANDLES[tier.id];
  if (!handle) throw new Error(`Unknown tier: ${tier.id}`);

  // Check if product already exists
  const existingQuery = `
    query GetCoachingProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        handle
        variants(first: 1) {
          nodes { id }
        }
      }
    }
  `;

  const { data: existingData } = await shopifyAdminFetch<{
    productByHandle: ShopifyProduct | null;
  }>({ query: existingQuery, variables: { handle } });

  if (existingData?.productByHandle?.variants?.nodes?.[0]?.id) {
    const variantId = existingData.productByHandle.variants.nodes[0].id;
    variantCache[tier.id] = variantId;
    return variantId;
  }

  // Create the product
  const createMutation = `
    mutation CreateCoachingProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          handle
          variants(first: 1) {
            nodes { id }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const { data: createData } = await shopifyAdminFetch<{
    productCreate: {
      product: ShopifyProduct | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>({
    query: createMutation,
    variables: {
      input: {
        title: TIER_TITLES[tier.id],
        handle,
        descriptionHtml: TIER_DESCRIPTIONS[tier.id],
        productType: "Coaching Subscription",
        vendor: "Axiom Metabolic",
        tags: ["coaching-tier", "subscription", tier.id],
        status: "DRAFT", // Admin reviews before publishing
        variants: [
          {
            price: tier.price.toFixed(2),
            inventoryManagement: null, // No inventory tracking
            inventoryPolicy: "CONTINUE", // Always allow purchase
            requiresShipping: false,
            taxable: false,
            sku: `COACHING-${tier.id.toUpperCase()}`,
          },
        ],
      },
    },
  });

  const errors = createData?.productCreate?.userErrors;
  if (errors?.length) {
    throw new Error(`Failed to create coaching product: ${errors.map((e) => e.message).join(", ")}`);
  }

  const variantId = createData?.productCreate?.product?.variants?.nodes?.[0]?.id;
  if (!variantId) throw new Error("Product created but no variant ID returned");

  variantCache[tier.id] = variantId;
  console.log(`[COACHING] Created product for tier ${tier.id}: ${variantId}`);

  return variantId;
}

/** Pre-create all coaching products (run during store setup) */
export async function createAllCoachingProducts(): Promise<Record<string, string>> {
  const { COACHING_TIERS } = await import("~/routes/coaching");
  const results: Record<string, string> = {};

  for (const tier of COACHING_TIERS) {
    try {
      const variantId = await ensureCoachingProductExists(tier);
      results[tier.id] = variantId;
      console.log(`[COACHING] ✅ ${tier.name}: ${variantId}`);
    } catch (err) {
      console.error(`[COACHING] ❌ ${tier.name}:`, err);
    }
  }

  return results;
}
