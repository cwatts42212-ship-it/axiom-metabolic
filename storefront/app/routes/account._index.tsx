/**
 * Axiom Metabolic — Account Dashboard Index
 * Route: /account
 * Renders the tabbed dashboard: Overview | Progress (Vault) | AI Coach | Orders
 */

import { redirect } from "@shopify/hydrogen";
import type { LoaderFunctionArgs } from "@shopify/hydrogen";
import { useLoaderData, Link, useLocation } from "react-router";
import { getVaultData, getCustomerGidByEmail } from "~/lib/shopify/vault";

export async function loader({ context }: LoaderFunctionArgs) {
  const { customerAccount } = context;
  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) return redirect("/account/login");

  const customer = await customerAccount.get();
  const email = customer?.customer?.emailAddress?.emailAddress ?? "";
  const firstName = customer?.customer?.firstName ?? "Client";

  const customerGid = await getCustomerGidByEmail(email);
  const vault = customerGid ? await getVaultData(customerGid) : null;

  return Response.json({
    firstName,
    email,
    hasVaultData: !!vault && (vault.entries?.length ?? 0) > 0,
    latestWeight: vault?.entries?.[0]?.weight ?? null,
    totalLost:
      vault?.startWeight && vault?.entries?.[0]?.weight
        ? parseFloat((vault.startWeight - vault.entries[0].weight).toFixed(1))
        : null,
    coachingTier: vault?.coachingTier ?? null,
    milestones: vault?.milestones ?? [],
  });
}

export default function AccountDashboard() {
  const { firstName, hasVaultData, latestWeight, totalLost, coachingTier, milestones } =
    useLoaderData<typeof loader>();
  const location = useLocation();

  const tabs = [
    { label: "Overview", path: "/account", exact: true },
    { label: "Progress", path: "/account/vault" },
    { label: "AI Coach", path: "/account/coach" },
    { label: "Orders", path: "/account/orders" },
    { label: "Profile", path: "/account/profile" },
  ];

  const isActive = (tab: { path: string; exact?: boolean }) =>
    tab.exact ? location.pathname === tab.path : location.pathname.startsWith(tab.path);

  return (
    <div className="account-shell">
      <nav className="account-tabs">
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={`account-tab${isActive(tab) ? " account-tab--active" : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="account-overview">
        <h1 className="overview-greeting">Welcome back, {firstName}.</h1>

        <div className="overview-grid">
          {/* Vault Summary Card */}
          <div className="overview-card">
            <div className="overview-card-icon">📊</div>
            <h3>Biometric Progress</h3>
            {hasVaultData ? (
              <>
                <p className="overview-stat">{latestWeight} lbs</p>
                {totalLost && (
                  <p className="overview-sub">
                    <span className="text-green">↓ {totalLost} lbs lost</span> total
                  </p>
                )}
                {milestones.length > 0 && (
                  <p className="overview-sub">
                    🏆 {milestones.length} milestone{milestones.length > 1 ? "s" : ""} achieved
                  </p>
                )}
              </>
            ) : (
              <p className="overview-sub">No data logged yet.</p>
            )}
            <Link to="/account/vault" className="overview-link">
              {hasVaultData ? "View Progress →" : "Log First Entry →"}
            </Link>
          </div>

          {/* AI Coach Card */}
          <div className="overview-card">
            <div className="overview-card-icon">🧠</div>
            <h3>AI Coach</h3>
            <p className="overview-sub">
              {coachingTier
                ? `Plan: ${
                    coachingTier === "ai-only"
                      ? "AI-Only"
                      : coachingTier === "biweekly-zoom"
                      ? "Bi-Weekly Zoom"
                      : "Weekly Zoom"
                  }`
                : "Your 24/7 coaching support"}
            </p>
            <p className="overview-sub">Ask anything about your protocol.</p>
            <Link to="/account/coach" className="overview-link">
              Chat with Coach →
            </Link>
          </div>

          {/* Orders Card */}
          <div className="overview-card">
            <div className="overview-card-icon">📦</div>
            <h3>Orders</h3>
            <p className="overview-sub">
              Track your food deliveries and order history.
            </p>
            <Link to="/account/orders" className="overview-link">
              View Orders →
            </Link>
          </div>

          {/* Upgrade CTA (if on AI-only or no tier) */}
          {(!coachingTier || coachingTier === "ai-only") && (
            <div className="overview-card overview-card--cta">
              <div className="overview-card-icon">🚀</div>
              <h3>Upgrade Your Coaching</h3>
              <p className="overview-sub">
                Add live Zoom sessions for deeper accountability and faster results.
              </p>
              <Link to="/coaching" className="overview-link overview-link--cta">
                See Coaching Plans →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
