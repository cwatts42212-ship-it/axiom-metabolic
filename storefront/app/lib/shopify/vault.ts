/**
 * Axiom Metabolic — Biometric Vault
 * Stores and retrieves full metabolic tracking data using Shopify Customer Metafields.
 * Namespace: axiom_vault | Key: biometrics
 *
 * All data is stored as JSON on the Customer object — zero external database required.
 */

import { shopifyAdminFetch, shopifyAdminRest } from "./admin-client";

// ── Data Types ───────────────────────────────────────────────────────────────

export interface BiometricEntry {
  date: string;             // ISO date string "YYYY-MM-DD"

  // Core weight
  weight: number;           // lbs

  // BMI (calculated or device-reported)
  bmi?: number;

  // Visceral fat (scale score, typically 1–59)
  visceralFat?: number;

  // Body fat
  bodyFatLbs?: number;      // lbs
  bodyFatPct?: number;      // percentage

  // Muscle
  muscleLbs?: number;       // lbs
  musclePct?: number;       // percentage

  // Lean mass
  leanMassLbs?: number;     // lbs
  leanMassPct?: number;     // percentage

  // Total body water
  totalBodyWaterPct?: number; // percentage

  // Optional measurements
  waist?: number;           // inches
  hips?: number;            // inches
  chest?: number;           // inches
  neck?: number;            // inches

  notes?: string;
}

export interface VaultData {
  entries: BiometricEntry[];
  startWeight?: number;
  goalWeight?: number;
  heightInches?: number;    // used for BMI auto-calculation
  coachingTier?: "ai-only" | "biweekly-zoom" | "weekly-zoom";
  lastLoggedAt?: string;
  milestones?: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT_NAMESPACE = "axiom_vault";
const VAULT_KEY = "biometrics";

// ── Metafield CRUD ───────────────────────────────────────────────────────────

/** Fetch the full vault for a customer by their Shopify customer GID */
export async function getVaultData(customerGid: string): Promise<VaultData | null> {
  const query = `
    query GetCustomerVault($id: ID!) {
      customer(id: $id) {
        id
        metafield(namespace: "${VAULT_NAMESPACE}", key: "${VAULT_KEY}") {
          value
        }
      }
    }
  `;

  const { data } = await shopifyAdminFetch<{
    customer: { metafield: { value: string } | null };
  }>({ query, variables: { id: customerGid } });

  if (!data?.customer?.metafield?.value) return null;

  try {
    return JSON.parse(data.customer.metafield.value) as VaultData;
  } catch {
    return null;
  }
}

/** Save/overwrite the full vault for a customer */
export async function saveVaultData(
  customerGid: string,
  vaultData: VaultData
): Promise<void> {
  const mutation = `
    mutation SetCustomerMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyAdminFetch<{
    metafieldsSet: { userErrors: { field: string; message: string }[] };
  }>({
    query: mutation,
    variables: {
      metafields: [
        {
          ownerId: customerGid,
          namespace: VAULT_NAMESPACE,
          key: VAULT_KEY,
          type: "json",
          value: JSON.stringify(vaultData),
        },
      ],
    },
  });

  const errors = data?.metafieldsSet?.userErrors;
  if (errors?.length) {
    throw new Error(`Vault save error: ${errors.map((e) => e.message).join(", ")}`);
  }
}

// ── Business Logic ───────────────────────────────────────────────────────────

/** Auto-calculate BMI if height is stored and weight is provided */
export function calculateBMI(weightLbs: number, heightInches: number): number {
  return parseFloat(((703 * weightLbs) / (heightInches * heightInches)).toFixed(1));
}

/** Append or update a single biometric entry; returns updated vault */
export async function logBiometricEntry(
  customerGid: string,
  entry: BiometricEntry
): Promise<{ vault: VaultData; newMilestones: string[] }> {
  const existing = (await getVaultData(customerGid)) ?? { entries: [] };

  // Auto-calculate BMI if height is set and BMI not provided
  if (!entry.bmi && existing.heightInches && entry.weight) {
    entry.bmi = calculateBMI(entry.weight, existing.heightInches);
  }

  // Replace entry for same date if it exists, otherwise append
  const idx = existing.entries.findIndex((e) => e.date === entry.date);
  if (idx >= 0) {
    existing.entries[idx] = entry;
  } else {
    existing.entries.push(entry);
  }

  // Sort entries newest first
  existing.entries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  existing.lastLoggedAt = new Date().toISOString();

  // Milestone detection
  const previousMilestones = new Set(existing.milestones ?? []);
  const newMilestones: string[] = [];

  if (existing.startWeight && entry.weight) {
    const lost = existing.startWeight - entry.weight;
    const milestoneWeights = [5, 10, 15, 20, 25, 30, 40, 50];
    for (const m of milestoneWeights) {
      const label = `${m}lbs lost`;
      if (lost >= m && !previousMilestones.has(label)) {
        newMilestones.push(label);
        previousMilestones.add(label);
      }
    }
  }

  existing.milestones = Array.from(previousMilestones);

  await saveVaultData(customerGid, existing);
  return { vault: existing, newMilestones };
}

// ── AI Coach Data Bridge ─────────────────────────────────────────────────────

/**
 * Generates a structured plain-text summary of a client's biometric history
 * suitable for injection into the OpenAI Assistant context.
 */
export function buildAIVaultSummary(
  vault: VaultData,
  customerName: string
): string {
  const entries = vault.entries ?? [];
  if (entries.length === 0) {
    return `${customerName} has not logged any biometrics yet.`;
  }

  const latest = entries[0];
  const startWeight = vault.startWeight;
  const goalWeight = vault.goalWeight;
  const totalLost = startWeight && latest.weight ? startWeight - latest.weight : null;
  const toGoal = goalWeight && latest.weight ? latest.weight - goalWeight : null;
  const milestones = vault.milestones ?? [];

  // Last 5 entries for trend context
  const recentEntries = entries.slice(0, 5);
  const trend = recentEntries
    .map(
      (e) =>
        `  ${e.date}: ${e.weight}lbs` +
        (e.bodyFatPct ? `, BF ${e.bodyFatPct}%` : "") +
        (e.bmi ? `, BMI ${e.bmi}` : "") +
        (e.visceralFat ? `, Visceral Fat ${e.visceralFat}` : "")
    )
    .join("\n");

  return `
BIOMETRIC VAULT SUMMARY FOR: ${customerName}
Coaching Tier: ${vault.coachingTier ?? "unknown"}
Total Entries: ${entries.length}

CURRENT STATS (${latest.date}):
- Weight: ${latest.weight} lbs
- BMI: ${latest.bmi ?? "not recorded"}
- Body Fat: ${latest.bodyFatPct ? `${latest.bodyFatPct}% (${latest.bodyFatLbs ?? "?"} lbs)` : "not recorded"}
- Muscle: ${latest.musclePct ? `${latest.musclePct}% (${latest.muscleLbs ?? "?"} lbs)` : "not recorded"}
- Lean Mass: ${latest.leanMassPct ? `${latest.leanMassPct}% (${latest.leanMassLbs ?? "?"} lbs)` : "not recorded"}
- Total Body Water: ${latest.totalBodyWaterPct ? `${latest.totalBodyWaterPct}%` : "not recorded"}
- Visceral Fat Score: ${latest.visceralFat ?? "not recorded"}

GOALS:
- Start Weight: ${startWeight ? `${startWeight} lbs` : "not set"}
- Goal Weight: ${goalWeight ? `${goalWeight} lbs` : "not set"}
- Total Lost: ${totalLost ? `${totalLost.toFixed(1)} lbs` : "n/a"}
- Remaining to Goal: ${toGoal ? `${toGoal.toFixed(1)} lbs` : "n/a"}

RECENT TREND (last 5 entries):
${trend}

MILESTONES ACHIEVED: ${milestones.length > 0 ? milestones.join(", ") : "none yet"}
  `.trim();
}

// ── Utility ──────────────────────────────────────────────────────────────────

/** Get customer GID from email using Admin REST */
export async function getCustomerGidByEmail(email: string): Promise<string | null> {
  const result = await shopifyAdminRest<{ customers: { id: number }[] }>(
    `customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`
  );
  if (!result.customers?.length) return null;
  return `gid://shopify/Customer/${result.customers[0].id}`;
}

/** Save coaching tier to customer metafield */
export async function saveCoachingTier(
  customerGid: string,
  tier: "ai-only" | "biweekly-zoom" | "weekly-zoom"
): Promise<void> {
  const mutation = `
    mutation SetTier($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;
  await shopifyAdminFetch({
    query: mutation,
    variables: {
      metafields: [
        {
          ownerId: customerGid,
          namespace: VAULT_NAMESPACE,
          key: "coaching_tier",
          type: "single_line_text_field",
          value: tier,
        },
      ],
    },
  });
}

/** Save height to vault (used for BMI auto-calculation) */
export async function saveHeight(
  customerGid: string,
  heightInches: number
): Promise<void> {
  const existing = (await getVaultData(customerGid)) ?? { entries: [] };
  existing.heightInches = heightInches;
  await saveVaultData(customerGid, existing);
}
