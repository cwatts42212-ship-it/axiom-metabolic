/**
 * Axiom Metabolic — Vault API Endpoint
 * Route: /api/vault
 *
 * Provides server-side access to vault data for:
 * 1. The AI Coach (to inject biometric context)
 * 2. Klaviyo inactivity checks (scheduled job)
 * 3. Admin review of client progress
 *
 * GET  /api/vault?email=... — returns vault data + AI summary
 * POST /api/vault           — log a biometric entry (used by native app or integrations)
 */

import { json } from "@shopify/hydrogen";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@shopify/hydrogen";
import {
  getVaultData,
  logBiometricEntry,
  getCustomerGidByEmail,
  buildAIVaultSummary,
} from "~/lib/shopify/vault";
import type { BiometricEntry } from "~/lib/shopify/vault";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email");

  if (!email) {
    return json({ error: "email parameter required" }, { status: 400 });
  }

  const customerGid = await getCustomerGidByEmail(email);
  if (!customerGid) {
    return json({ error: "Customer not found" }, { status: 404 });
  }

  const vault = await getVaultData(customerGid);
  if (!vault) {
    return json({ vault: null, aiSummary: "No biometric data logged yet." });
  }

  const aiSummary = buildAIVaultSummary(vault, email);

  return json({
    vault,
    aiSummary,
    stats: {
      entryCount: vault.entries.length,
      latestWeight: vault.entries[0]?.weight ?? null,
      totalLost:
        vault.startWeight && vault.entries[0]?.weight
          ? parseFloat((vault.startWeight - vault.entries[0].weight).toFixed(1))
          : null,
      lastLoggedAt: vault.lastLoggedAt ?? null,
      milestones: vault.milestones ?? [],
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as { email: string; entry: BiometricEntry };
  const { email, entry } = body;

  if (!email || !entry?.weight || !entry?.date) {
    return json({ error: "email, entry.date, and entry.weight are required" }, { status: 400 });
  }

  const customerGid = await getCustomerGidByEmail(email);
  if (!customerGid) {
    return json({ error: "Customer not found" }, { status: 404 });
  }

  const { vault, newMilestones } = await logBiometricEntry(customerGid, entry);

  return json({
    success: true,
    newMilestones,
    entryCount: vault.entries.length,
    latestWeight: vault.entries[0]?.weight,
  });
}
