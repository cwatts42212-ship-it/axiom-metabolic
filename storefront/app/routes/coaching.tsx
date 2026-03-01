/**
 * Axiom Metabolic — Coaching Tiers Landing Page
 * Route: /coaching
 *
 * Dedicated landing page for coaching package selection.
 * Clients MUST select a coaching tier before proceeding to food item selection.
 * Tier selection is stored in session and attached to the cart as a line item attribute.
 *
 * Tiers:
 *  - Tier 1: AI-Only ($97/month)
 *  - Tier 2: Bi-Weekly Zoom ($147/month)
 *  - Tier 3: Weekly Zoom ($197/month)
 */

import { redirect } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useLoaderData, Form, useNavigation, Link } from "react-router";
import { shopifyAdminFetch } from "~/lib/shopify/admin-client";

// ── Coaching Tier Definitions ─────────────────────────────────────────────────

export const COACHING_TIERS = [
  {
    id: "ai-only",
    name: "AI Coach",
    subtitle: "Tier 1 — Foundation",
    price: 97,
    interval: "month",
    color: "#10b981",
    icon: "🧠",
    features: [
      "24/7 AI Coach access",
      "Personalized protocol support",
      "Biometric Vault tracking",
      "Milestone celebration alerts",
      "Smart SMS check-ins",
      "Food item ordering",
    ],
    notIncluded: ["Live Zoom sessions", "Human coach review"],
    cta: "Start with AI Coach",
    popular: false,
  },
  {
    id: "biweekly-zoom",
    name: "Bi-Weekly Zoom",
    subtitle: "Tier 2 — Accelerate",
    price: 147,
    interval: "month",
    color: "#6366f1",
    icon: "📹",
    features: [
      "Everything in AI Coach",
      "2 live Zoom sessions/month",
      "Human coach escalation review",
      "Personalized meal planning",
      "Priority SMS response",
      "Food item ordering",
    ],
    notIncluded: ["Weekly Zoom sessions"],
    cta: "Choose Bi-Weekly Zoom",
    popular: true,
  },
  {
    id: "weekly-zoom",
    name: "Weekly Zoom",
    subtitle: "Tier 3 — Elite",
    price: 197,
    interval: "month",
    color: "#f59e0b",
    icon: "⭐",
    features: [
      "Everything in Bi-Weekly",
      "4 live Zoom sessions/month",
      "Weekly progress reviews",
      "Direct coach messaging",
      "Custom protocol adjustments",
      "Food item ordering",
    ],
    notIncluded: [],
    cta: "Choose Weekly Zoom",
    popular: false,
  },
];

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ context }: LoaderFunctionArgs) {
  const { customerAccount } = context;
  const isLoggedIn = await customerAccount.isLoggedIn();

  // Fetch coaching products from Shopify (if they exist)
  let coachingProducts: Record<string, { variantId: string; productId: string }> = {};

  try {
    const query = `
      query GetCoachingProducts {
        products(first: 10, query: "tag:coaching-tier") {
          nodes {
            id
            handle
            title
            variants(first: 1) {
              nodes { id }
            }
          }
        }
      }
    `;
    const { data } = await shopifyAdminFetch<{
      products: {
        nodes: Array<{
          id: string;
          handle: string;
          title: string;
          variants: { nodes: Array<{ id: string }> };
        }>;
      };
    }>({ query });

    for (const product of data?.products?.nodes ?? []) {
      const tierId = product.handle.replace("coaching-", "");
      coachingProducts[tierId] = {
        productId: product.id,
        variantId: product.variants.nodes[0]?.id ?? "",
      };
    }
  } catch {
    // Products not yet created — will be created on first purchase
  }

  return Response.json({ isLoggedIn, coachingProducts, tiers: COACHING_TIERS });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const tierId = formData.get("tierId") as string;
  const tier = COACHING_TIERS.find((t) => t.id === tierId);

  if (!tier) {
    return Response.json({ error: "Invalid coaching tier selected." }, { status: 400 });
  }

  // Store selected tier in session and redirect to food selection
  const { session } = context;
  session.set("selectedCoachingTier", tierId);

  return redirect(`/coaching/checkout?tier=${tierId}`);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoachingPage() {
  const { isLoggedIn, tiers } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="coaching-page">

      {/* ── Hero ── */}
      <div className="coaching-hero">
        <div className="coaching-hero-badge">Step 1 of 2 — Choose Your Coaching Plan</div>
        <h1 className="coaching-hero-title">
          Your transformation starts with the right support.
        </h1>
        <p className="coaching-hero-sub">
          Select your coaching tier below. After checkout, you'll choose your Ideal Protein
          food items. All plans include AI coaching, biometric tracking, and smart SMS support.
        </p>
      </div>

      {/* ── Tiers Grid ── */}
      <div className="tiers-grid">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className={`tier-card${tier.popular ? " tier-card--popular" : ""}`}
            style={{ "--tier-color": tier.color } as React.CSSProperties}
          >
            {tier.popular && (
              <div className="tier-popular-badge">Most Popular</div>
            )}

            <div className="tier-icon">{tier.icon}</div>
            <div className="tier-subtitle">{tier.subtitle}</div>
            <h2 className="tier-name">{tier.name}</h2>

            <div className="tier-price">
              <span className="tier-price-dollar">$</span>
              <span className="tier-price-amount">{tier.price}</span>
              <span className="tier-price-interval">/{tier.interval}</span>
            </div>

            <ul className="tier-features">
              {tier.features.map((f) => (
                <li key={f} className="tier-feature tier-feature--included">
                  <span className="feature-check">✓</span> {f}
                </li>
              ))}
              {tier.notIncluded.map((f) => (
                <li key={f} className="tier-feature tier-feature--excluded">
                  <span className="feature-x">✗</span> {f}
                </li>
              ))}
            </ul>

            <Form method="post">
              <input type="hidden" name="tierId" value={tier.id} />
              <button
                type="submit"
                className="tier-cta"
                disabled={isSubmitting}
                style={{ background: tier.color } as React.CSSProperties}
              >
                {isSubmitting && navigation.formData?.get("tierId") === tier.id
                  ? "Loading..."
                  : tier.cta}
              </button>
            </Form>
          </div>
        ))}
      </div>

      {/* ── FAQ / Trust ── */}
      <div className="coaching-trust">
        <div className="trust-item">
          <span className="trust-icon">🔄</span>
          <div>
            <strong>Cancel Anytime</strong>
            <p>No contracts. Cancel or change your tier at any time.</p>
          </div>
        </div>
        <div className="trust-item">
          <span className="trust-icon">📦</span>
          <div>
            <strong>Food Ships Separately</strong>
            <p>After selecting your tier, you'll choose your Ideal Protein food items.</p>
          </div>
        </div>
        <div className="trust-item">
          <span className="trust-icon">🔒</span>
          <div>
            <strong>Secure Checkout</strong>
            <p>Powered by Shopify. Your data is always protected.</p>
          </div>
        </div>
      </div>

      {isLoggedIn && (
        <div className="coaching-existing">
          Already a member?{" "}
          <Link to="/account" className="coaching-link">
            Go to your dashboard →
          </Link>
        </div>
      )}
    </div>
  );
}
