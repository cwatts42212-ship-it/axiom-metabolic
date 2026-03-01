/**
 * Axiom Metabolic — Shopify Admin API Client
 * Used server-side only for metafields, webhooks, fulfillment, and product management.
 */

const SHOPIFY_STORE_DOMAIN = "axiom-metabolic.myshopify.com";
const SHOPIFY_API_VERSION = "2025-01";

export async function shopifyAdminFetch<T = unknown>({
  query,
  variables,
}: {
  query: string;
  variables?: Record<string, unknown>;
}): Promise<{ data: T; errors?: unknown[] }> {
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!adminToken) throw new Error("SHOPIFY_ADMIN_API_TOKEN is not set");

  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify Admin API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<{ data: T; errors?: unknown[] }>;
}

/** REST helper for Admin API endpoints that don't have GraphQL equivalents */
export async function shopifyAdminRest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!adminToken) throw new Error("SHOPIFY_ADMIN_API_TOKEN is not set");

  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
        ...(options.headers ?? {}),
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify Admin REST error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}
