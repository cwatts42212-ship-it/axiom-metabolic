/**
 * Axiom Metabolic — Coaching Checkout (Step 2)
 * Route: /coaching/checkout?tier=ai-only|biweekly-zoom|weekly-zoom
 *
 * Step-up checkout flow:
 *  1. Confirms selected coaching tier
 *  2. Displays food items for selection (from Shopify collections)
 *  3. Adds coaching tier product + selected food items to cart
 *  4. Redirects to Shopify checkout
 *
 * The coaching tier is added as a recurring subscription line item.
 * Food items are added as one-time purchase line items.
 */

import { redirect } from "@shopify/hydrogen";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@shopify/hydrogen";
import { useLoaderData, Form, useNavigation, Link } from "react-router";
import { useState } from "react";
import { COACHING_TIERS } from "./coaching";
import { shopifyAdminFetch } from "~/lib/shopify/admin-client";
import { ensureCoachingProductExists } from "~/lib/shopify/coaching-products";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FoodProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  priceRange: { minVariantPrice: { amount: string } };
  images: { nodes: Array<{ url: string; altText: string | null }> };
  variants: { nodes: Array<{ id: string; title: string; availableForSale: boolean }> };
  tags: string[];
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { customerAccount, storefront } = context;

  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) {
    return redirect(`/account/login?redirect=/coaching/checkout${new URL(request.url).search}`);
  }

  const url = new URL(request.url);
  const tierId = url.searchParams.get("tier") ?? "ai-only";
  const tier = COACHING_TIERS.find((t) => t.id === tierId) ?? COACHING_TIERS[0];

  // Fetch food products from Shopify Storefront API
  const FOOD_PRODUCTS_QUERY = `
    query GetFoodProducts($first: Int!) {
      collections(first: 5, query: "title:Ideal Protein OR title:Food") {
        nodes {
          id
          title
          products(first: $first) {
            nodes {
              id
              title
              handle
              description
              priceRange {
                minVariantPrice { amount }
              }
              images(first: 1) {
                nodes { url altText }
              }
              variants(first: 5) {
                nodes { id title availableForSale }
              }
              tags
            }
          }
        }
      }
    }
  `;

  let foodProducts: FoodProduct[] = [];
  let collections: Array<{ id: string; title: string; products: FoodProduct[] }> = [];

  try {
    const { collections: cols } = await storefront.query(FOOD_PRODUCTS_QUERY, {
      variables: { first: 50 },
    });

    collections = (cols?.nodes ?? []).map((col: {
      id: string;
      title: string;
      products: { nodes: FoodProduct[] };
    }) => ({
      id: col.id,
      title: col.title,
      products: col.products.nodes,
    }));

    foodProducts = collections.flatMap((c) => c.products);
  } catch {
    // No products yet — show empty state
  }

  // Ensure coaching product exists in Shopify
  let coachingVariantId: string | null = null;
  try {
    coachingVariantId = await ensureCoachingProductExists(tier);
  } catch {
    // Will be created on first purchase attempt
  }

  return Response.json({
    tier,
    foodProducts,
    collections,
    coachingVariantId,
    isLoggedIn,
  });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request, context }: ActionFunctionArgs) {
  const { cart } = context;
  const formData = await request.formData();
  const tierId = formData.get("tierId") as string;
  const coachingVariantId = formData.get("coachingVariantId") as string;
  const selectedVariantsJson = formData.get("selectedVariants") as string;

  let selectedVariants: Array<{ variantId: string; quantity: number }> = [];
  try {
    selectedVariants = JSON.parse(selectedVariantsJson);
  } catch {
    return Response.json({ error: "Invalid product selection." }, { status: 400 });
  }

  if (!coachingVariantId) {
    return Response.json(
      { error: "Coaching product not found. Please contact support." },
      { status: 400 }
    );
  }

  const tier = COACHING_TIERS.find((t) => t.id === tierId);
  if (!tier) {
    return Response.json({ error: "Invalid tier." }, { status: 400 });
  }

  // Build cart lines
  const lines = [
    // Coaching tier as first line item with subscription attribute
    {
      merchandiseId: coachingVariantId,
      quantity: 1,
      attributes: [
        { key: "coaching_tier", value: tierId },
        { key: "tier_name", value: tier.name },
        { key: "billing_interval", value: "monthly" },
        { key: "_is_subscription", value: "true" },
      ],
    },
    // Food items
    ...selectedVariants.map(({ variantId, quantity }) => ({
      merchandiseId: variantId,
      quantity,
      attributes: [
        { key: "coaching_tier", value: tierId },
        { key: "_drop_ship", value: "true" },
      ],
    })),
  ];

  // Add all items to cart and get checkout URL
  const result = await cart.addLines(lines);
  const checkoutUrl = result.cart?.checkoutUrl;

  if (!checkoutUrl) {
    return Response.json({ error: "Failed to create cart. Please try again." }, { status: 500 });
  }

  return redirect(checkoutUrl);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoachingCheckout() {
  const { tier, collections, coachingVariantId } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [selectedVariants, setSelectedVariants] = useState<
    Record<string, { variantId: string; quantity: number; productTitle: string; price: string }>
  >({});
  const [activeCollection, setActiveCollection] = useState(0);

  const toggleVariant = (
    productId: string,
    variantId: string,
    productTitle: string,
    price: string
  ) => {
    setSelectedVariants((prev) => {
      const existing = prev[productId];
      if (existing) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [productId]: { variantId, quantity: 1, productTitle, price } };
    });
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) {
      const { [productId]: _, ...rest } = selectedVariants;
      setSelectedVariants(rest);
      return;
    }
    setSelectedVariants((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], quantity },
    }));
  };

  const selectedCount = Object.keys(selectedVariants).length;
  const foodTotal = Object.values(selectedVariants).reduce(
    (sum, v) => sum + parseFloat(v.price) * v.quantity,
    0
  );
  const monthlyTotal = tier.price + foodTotal;

  const variantsForSubmit = Object.values(selectedVariants).map(({ variantId, quantity }) => ({
    variantId,
    quantity,
  }));

  return (
    <div className="checkout-page">

      {/* ── Progress Steps ── */}
      <div className="checkout-steps">
        <Link to="/coaching" className="step step--done">
          <span className="step-num">✓</span>
          <span>Choose Plan</span>
        </Link>
        <div className="step-divider" />
        <div className="step step--active">
          <span className="step-num">2</span>
          <span>Select Food Items</span>
        </div>
        <div className="step-divider" />
        <div className="step step--pending">
          <span className="step-num">3</span>
          <span>Checkout</span>
        </div>
      </div>

      <div className="checkout-layout">

        {/* ── Food Selection Panel ── */}
        <div className="food-panel">
          <h2 className="food-panel-title">
            Select Your Ideal Protein Food Items
            <span className="food-panel-sub">
              Choose as many as you'd like. Shipped directly to you.
            </span>
          </h2>

          {/* Collection tabs */}
          {collections.length > 1 && (
            <div className="collection-tabs">
              {collections.map((col, idx) => (
                <button
                  key={col.id}
                  className={`collection-tab${activeCollection === idx ? " collection-tab--active" : ""}`}
                  onClick={() => setActiveCollection(idx)}
                  type="button"
                >
                  {col.title}
                </button>
              ))}
            </div>
          )}

          {collections.length === 0 ? (
            <div className="no-products">
              <p>Products are being added to the store.</p>
              <p>You can proceed to checkout with just your coaching plan and add food items later.</p>
            </div>
          ) : (
            <div className="food-grid">
              {(collections[activeCollection]?.products ?? []).map((product) => {
                const isSelected = !!selectedVariants[product.id];
                const defaultVariant = product.variants.nodes[0];
                const price = product.priceRange.minVariantPrice.amount;
                const image = product.images.nodes[0];

                return (
                  <div
                    key={product.id}
                    className={`food-card${isSelected ? " food-card--selected" : ""}`}
                    onClick={() =>
                      defaultVariant &&
                      toggleVariant(product.id, defaultVariant.id, product.title, price)
                    }
                  >
                    {isSelected && <div className="food-card-check">✓</div>}

                    {image && (
                      <img
                        src={image.url}
                        alt={image.altText ?? product.title}
                        className="food-card-image"
                      />
                    )}

                    <div className="food-card-body">
                      <h3 className="food-card-title">{product.title}</h3>
                      <p className="food-card-price">${parseFloat(price).toFixed(2)}</p>

                      {/* Variant selector for products with multiple variants */}
                      {product.variants.nodes.length > 1 && (
                        <select
                          className="food-variant-select"
                          onChange={(e) => {
                            const variant = product.variants.nodes.find(
                              (v) => v.id === e.target.value
                            );
                            if (variant) {
                              setSelectedVariants((prev) => ({
                                ...prev,
                                [product.id]: {
                                  ...prev[product.id],
                                  variantId: variant.id,
                                },
                              }));
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {product.variants.nodes.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.title}
                            </option>
                          ))}
                        </select>
                      )}

                      {isSelected && (
                        <div
                          className="food-qty-row"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              updateQuantity(
                                product.id,
                                (selectedVariants[product.id]?.quantity ?? 1) - 1
                              )
                            }
                          >
                            −
                          </button>
                          <span className="qty-value">
                            {selectedVariants[product.id]?.quantity ?? 1}
                          </span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              updateQuantity(
                                product.id,
                                (selectedVariants[product.id]?.quantity ?? 1) + 1
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Order Summary Sidebar ── */}
        <div className="order-summary">
          <h3 className="summary-title">Order Summary</h3>

          {/* Coaching Tier */}
          <div className="summary-section">
            <div className="summary-label">Coaching Plan</div>
            <div className="summary-item">
              <span>
                {tier.icon} {tier.name}
                <span className="summary-recurring"> · monthly</span>
              </span>
              <span>${tier.price}/mo</span>
            </div>
          </div>

          {/* Food Items */}
          {selectedCount > 0 && (
            <div className="summary-section">
              <div className="summary-label">Food Items ({selectedCount})</div>
              {Object.values(selectedVariants).map((v) => (
                <div key={v.variantId} className="summary-item">
                  <span className="summary-item-name">
                    {v.productTitle} ×{v.quantity}
                  </span>
                  <span>${(parseFloat(v.price) * v.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="summary-divider" />

          <div className="summary-total">
            <span>First Month Total</span>
            <span>${monthlyTotal.toFixed(2)}</span>
          </div>
          <p className="summary-recurring-note">
            Coaching plan renews at ${tier.price}/month. Food items billed per order.
          </p>

          <Form method="post">
            <input type="hidden" name="tierId" value={tier.id} />
            <input type="hidden" name="coachingVariantId" value={coachingVariantId ?? ""} />
            <input
              type="hidden"
              name="selectedVariants"
              value={JSON.stringify(variantsForSubmit)}
            />
            <button
              type="submit"
              className="summary-checkout-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Building your cart..." : "Proceed to Checkout →"}
            </button>
          </Form>

          <p className="summary-skip">
            <button
              type="button"
              className="summary-skip-link"
              onClick={() => {
                // Allow checkout with coaching tier only
                const form = document.querySelector("form") as HTMLFormElement;
                if (form) form.requestSubmit();
              }}
            >
              Skip food items — coaching plan only
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
