/**
 * Axiom Metabolic — Biometric Vault Dashboard
 * Route: /vault
 * Protected: requires customer login
 */

import { redirect } from "@shopify/hydrogen";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@shopify/hydrogen";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { getVaultData, logBiometricEntry, getCustomerGidByEmail } from "~/lib/shopify/vault";
import type { VaultData, BiometricEntry } from "~/lib/shopify/vault";
import { triggerMilestoneCelebration } from "~/lib/klaviyo/sms";

export async function loader({ context }: LoaderFunctionArgs) {
  const { customerAccount } = context;

  // Require login
  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) {
    return redirect("/account/login?redirect=/vault");
  }

  const customer = await customerAccount.get();
  const email = customer?.customer?.emailAddress?.emailAddress ?? "";
  const firstName = customer?.customer?.firstName ?? "Client";

  // Get customer GID and vault data
  const customerGid = await getCustomerGidByEmail(email);
  const vaultData: VaultData = customerGid
    ? (await getVaultData(customerGid)) ?? { entries: [] }
    : { entries: [] };

  // Calculate stats
  const entries = vaultData.entries ?? [];
  const latestWeight = entries[0]?.weight ?? null;
  const startWeight = vaultData.startWeight ?? null;
  const totalLost = startWeight && latestWeight ? startWeight - latestWeight : null;
  const goalWeight = vaultData.goalWeight ?? null;
  const toGoal = goalWeight && latestWeight ? latestWeight - goalWeight : null;

  return Response.json({
    firstName,
    email,
    customerGid,
    vaultData,
    stats: { latestWeight, startWeight, totalLost, toGoal, goalWeight },
    milestones: vaultData.milestones ?? [],
    lastLoggedAt: vaultData.lastLoggedAt ?? null,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { customerAccount } = context;
  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) return redirect("/account/login");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const customer = await customerAccount.get();
  const email = customer?.customer?.emailAddress?.emailAddress ?? "";
  const firstName = customer?.customer?.firstName ?? "Client";
  const phone = customer?.customer?.phoneNumber?.phoneNumber ?? "";

  const customerGid = await getCustomerGidByEmail(email);
  if (!customerGid) {
    return Response.json({ error: "Could not find your account. Please contact support." }, { status: 400 });
  }

  if (intent === "log_biometric") {
    const entry: BiometricEntry = {
      date: formData.get("date") as string,
      weight: parseFloat(formData.get("weight") as string),
      bodyFat: formData.get("bodyFat") ? parseFloat(formData.get("bodyFat") as string) : undefined,
      waist: formData.get("waist") ? parseFloat(formData.get("waist") as string) : undefined,
      hips: formData.get("hips") ? parseFloat(formData.get("hips") as string) : undefined,
      chest: formData.get("chest") ? parseFloat(formData.get("chest") as string) : undefined,
      notes: formData.get("notes") as string | undefined,
    };

    const updatedVault = await logBiometricEntry(customerGid, entry);

    // Check for new milestones and trigger SMS
    if (updatedVault.startWeight && entry.weight && phone) {
      const totalLost = updatedVault.startWeight - entry.weight;
      const milestoneWeights = [5, 10, 15, 20, 25, 30];
      for (const m of milestoneWeights) {
        if (totalLost >= m) {
          const label = `${m}lbs lost`;
          const previousMilestones = (updatedVault.milestones ?? []).filter((x) => x !== label);
          if (!previousMilestones.includes(label)) {
            await triggerMilestoneCelebration(email, phone, firstName, m).catch(console.error);
          }
        }
      }
    }

    return Response.json({ success: true, message: "Biometrics logged successfully! 💪" });
  }

  if (intent === "set_goals") {
    const existing = (await getVaultData(customerGid)) ?? { entries: [] };
    existing.startWeight = parseFloat(formData.get("startWeight") as string);
    existing.goalWeight = parseFloat(formData.get("goalWeight") as string);

    const { saveVaultData } = await import("~/lib/shopify/vault");
    await saveVaultData(customerGid, existing);
    return Response.json({ success: true, message: "Goals updated!" });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export default function VaultDashboard() {
  const { firstName, vaultData, stats, milestones, lastLoggedAt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const today = new Date().toISOString().split("T")[0];
  const entries = vaultData.entries ?? [];

  return (
    <div className="vault-dashboard">
      <div className="vault-header">
        <h1>The Vault</h1>
        <p className="vault-subtitle">Your Biometric Command Center, {firstName}</p>
        {lastLoggedAt && (
          <p className="last-logged">
            Last logged: {new Date(lastLoggedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Stats Row */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Current Weight</span>
          <span className="stat-value">{stats.latestWeight ? `${stats.latestWeight} lbs` : "—"}</span>
        </div>
        <div className="stat-card highlight">
          <span className="stat-label">Total Lost</span>
          <span className="stat-value">
            {stats.totalLost ? `${stats.totalLost.toFixed(1)} lbs` : "—"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Goal Weight</span>
          <span className="stat-value">{stats.goalWeight ? `${stats.goalWeight} lbs` : "—"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">To Goal</span>
          <span className="stat-value">
            {stats.toGoal ? `${stats.toGoal.toFixed(1)} lbs` : "—"}
          </span>
        </div>
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="milestones-section">
          <h3>🏆 Milestones Achieved</h3>
          <div className="milestones-list">
            {milestones.map((m) => (
              <span key={m} className="milestone-badge">{m}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action Feedback */}
      {actionData && "message" in actionData && (
        <div className="action-success">{actionData.message}</div>
      )}
      {actionData && "error" in actionData && (
        <div className="action-error">{actionData.error}</div>
      )}

      {/* Log Biometrics Form */}
      <div className="vault-card">
        <h2>Log Today's Biometrics</h2>
        <Form method="post" className="biometric-form">
          <input type="hidden" name="intent" value="log_biometric" />
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="date">Date</label>
              <input type="date" id="date" name="date" defaultValue={today} required />
            </div>
            <div className="form-group required">
              <label htmlFor="weight">Weight (lbs) *</label>
              <input type="number" id="weight" name="weight" step="0.1" min="50" max="600" required placeholder="e.g. 185.5" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="bodyFat">Body Fat %</label>
              <input type="number" id="bodyFat" name="bodyFat" step="0.1" min="1" max="70" placeholder="Optional" />
            </div>
            <div className="form-group">
              <label htmlFor="waist">Waist (in)</label>
              <input type="number" id="waist" name="waist" step="0.25" placeholder="Optional" />
            </div>
            <div className="form-group">
              <label htmlFor="hips">Hips (in)</label>
              <input type="number" id="hips" name="hips" step="0.25" placeholder="Optional" />
            </div>
            <div className="form-group">
              <label htmlFor="chest">Chest (in)</label>
              <input type="number" id="chest" name="chest" step="0.25" placeholder="Optional" />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} placeholder="How are you feeling? Any compliance notes?" />
          </div>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Log Biometrics"}
          </button>
        </Form>
      </div>

      {/* Set Goals Form */}
      <div className="vault-card">
        <h2>Set Your Goals</h2>
        <Form method="post" className="goals-form">
          <input type="hidden" name="intent" value="set_goals" />
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="startWeight">Starting Weight (lbs)</label>
              <input
                type="number"
                id="startWeight"
                name="startWeight"
                step="0.1"
                defaultValue={stats.startWeight ?? ""}
                placeholder="Your weight when you started"
              />
            </div>
            <div className="form-group">
              <label htmlFor="goalWeight">Goal Weight (lbs)</label>
              <input
                type="number"
                id="goalWeight"
                name="goalWeight"
                step="0.1"
                defaultValue={stats.goalWeight ?? ""}
                placeholder="Your target weight"
              />
            </div>
          </div>
          <button type="submit" className="btn-secondary" disabled={isSubmitting}>
            Save Goals
          </button>
        </Form>
      </div>

      {/* History Table */}
      {entries.length > 0 && (
        <div className="vault-card">
          <h2>Progress History</h2>
          <div className="table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Weight</th>
                  <th>Body Fat</th>
                  <th>Waist</th>
                  <th>Hips</th>
                  <th>Change</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const prev = entries[idx + 1];
                  const change = prev ? entry.weight - prev.weight : null;
                  return (
                    <tr key={entry.date}>
                      <td>{new Date(entry.date).toLocaleDateString()}</td>
                      <td><strong>{entry.weight} lbs</strong></td>
                      <td>{entry.bodyFat ? `${entry.bodyFat}%` : "—"}</td>
                      <td>{entry.waist ? `${entry.waist}"` : "—"}</td>
                      <td>{entry.hips ? `${entry.hips}"` : "—"}</td>
                      <td className={change === null ? "" : change < 0 ? "change-down" : "change-up"}>
                        {change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}`}
                      </td>
                      <td>{entry.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
