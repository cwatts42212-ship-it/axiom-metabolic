/**
 * Axiom Metabolic — Biometric Progress Engine
 * Route: /account/vault  (nested under the account dashboard)
 *
 * Features:
 *  - Full metabolic data entry form (all 10 field groups per spec)
 *  - 6-card stats overview (current weight, total lost, goal, to-go, BMI, body fat %)
 *  - Body composition summary panel (muscle, lean mass, total body water)
 *  - Chart.js: Weight trend, Body Fat % trend, BMI trend (3 charts)
 *  - Responsive history table with Δ change indicators
 *  - Milestone tracking with Klaviyo SMS trigger
 *  - AI Coach data bridge via buildAIVaultSummary()
 */

import { redirect } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import {
  getVaultData,
  logBiometricEntry,
  saveVaultData,
  getCustomerGidByEmail,
  calculateBMI,
  buildAIVaultSummary,
} from "~/lib/shopify/vault";
import type { BiometricEntry, VaultData } from "~/lib/shopify/vault";
import { triggerMilestoneCelebration } from "~/lib/klaviyo/sms";
import { useEffect, useRef } from "react";

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ context }: LoaderFunctionArgs) {
  const { customerAccount } = context;

  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) return redirect("/account/login?redirect=/account/vault");

  const customer = await customerAccount.get();
  const email = customer?.customer?.emailAddress?.emailAddress ?? "";
  const firstName = customer?.customer?.firstName ?? "Client";
  const lastName = customer?.customer?.lastName ?? "";
  const phone = customer?.customer?.phoneNumber?.phoneNumber ?? "";

  const customerGid = await getCustomerGidByEmail(email);
  const vault: VaultData = customerGid
    ? (await getVaultData(customerGid)) ?? { entries: [] }
    : { entries: [] };

  const entries = vault.entries ?? [];
  const latest = entries[0] ?? null;
  const previous = entries[1] ?? null;

  // Stats
  const totalLost =
    vault.startWeight && latest?.weight
      ? parseFloat((vault.startWeight - latest.weight).toFixed(1))
      : null;
  const toGoal =
    vault.goalWeight && latest?.weight
      ? parseFloat((latest.weight - vault.goalWeight).toFixed(1))
      : null;

  // Week-over-week delta
  const weekDelta =
    latest?.weight && previous?.weight
      ? parseFloat((latest.weight - previous.weight).toFixed(1))
      : null;

  // Chart data — chronological order (oldest first) for Chart.js
  const chartEntries = [...entries].reverse();
  const chartData = {
    labels: chartEntries.map((e) => e.date),
    weight: chartEntries.map((e) => e.weight ?? null),
    bodyFatPct: chartEntries.map((e) => e.bodyFatPct ?? null),
    bmi: chartEntries.map((e) => e.bmi ?? null),
    musclePct: chartEntries.map((e) => e.musclePct ?? null),
    visceralFat: chartEntries.map((e) => e.visceralFat ?? null),
  };

  // AI summary (used by coach route)
  const aiSummary = buildAIVaultSummary(vault, `${firstName} ${lastName}`.trim());

  return Response.json({
    firstName,
    email,
    phone,
    customerGid,
    vault,
    entries,
    latest,
    weekDelta,
    stats: {
      latestWeight: latest?.weight ?? null,
      startWeight: vault.startWeight ?? null,
      goalWeight: vault.goalWeight ?? null,
      totalLost,
      toGoal,
      heightInches: vault.heightInches ?? null,
      latestBmi: latest?.bmi ?? null,
      latestBodyFatPct: latest?.bodyFatPct ?? null,
      latestMusclePct: latest?.musclePct ?? null,
      latestLeanMassPct: latest?.leanMassPct ?? null,
      latestTbwPct: latest?.totalBodyWaterPct ?? null,
      latestVisceralFat: latest?.visceralFat ?? null,
    },
    milestones: vault.milestones ?? [],
    lastLoggedAt: vault.lastLoggedAt ?? null,
    chartData,
    aiSummary,
  });
}

// ── Action ───────────────────────────────────────────────────────────────────

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
    return Response.json({ error: "Account not found. Please contact support." }, { status: 400 });
  }

  // ── Log biometric entry ──
  if (intent === "log_biometric") {
    const num = (key: string) => {
      const v = formData.get(key);
      return v && v !== "" ? parseFloat(v as string) : undefined;
    };

    const weightVal = parseFloat(formData.get("weight") as string);
    if (isNaN(weightVal)) {
      return Response.json({ error: "Weight is required and must be a valid number." }, { status: 400 });
    }

    const entry: BiometricEntry = {
      date: (formData.get("date") as string) || new Date().toISOString().split("T")[0],
      weight: weightVal,
      bmi: num("bmi"),
      visceralFat: num("visceralFat"),
      bodyFatLbs: num("bodyFatLbs"),
      bodyFatPct: num("bodyFatPct"),
      muscleLbs: num("muscleLbs"),
      musclePct: num("musclePct"),
      leanMassLbs: num("leanMassLbs"),
      leanMassPct: num("leanMassPct"),
      totalBodyWaterPct: num("totalBodyWaterPct"),
      waist: num("waist"),
      hips: num("hips"),
      chest: num("chest"),
      neck: num("neck"),
      notes: (formData.get("notes") as string) || undefined,
    };

    const { newMilestones } = await logBiometricEntry(customerGid, entry);

    // Fire Klaviyo SMS for each new milestone
    if (phone && newMilestones.length > 0) {
      for (const milestone of newMilestones) {
        const lbs = parseInt(milestone);
        if (!isNaN(lbs)) {
          await triggerMilestoneCelebration(email, phone, firstName, lbs).catch(console.error);
        }
      }
    }

    return Response.json({
      success: true,
      message: `Biometrics logged for ${entry.date}!${newMilestones.length > 0 ? ` 🏆 New milestone: ${newMilestones.join(", ")}!` : ""}`,
      newMilestones,
    });
  }

  // ── Update goals & profile ──
  if (intent === "set_goals") {
    const existing = (await getVaultData(customerGid)) ?? { entries: [] };
    const startWeight = formData.get("startWeight");
    const goalWeight = formData.get("goalWeight");
    const heightFt = formData.get("heightFt");
    const heightIn = formData.get("heightIn");

    if (startWeight) existing.startWeight = parseFloat(startWeight as string);
    if (goalWeight) existing.goalWeight = parseFloat(goalWeight as string);
    if (heightFt && heightIn) {
      existing.heightInches =
        parseInt(heightFt as string) * 12 + parseInt(heightIn as string);
    }

    await saveVaultData(customerGid, existing);
    return Response.json({ success: true, message: "Profile & goals updated!" });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VaultProgress() {
  const {
    firstName,
    vault,
    entries,
    latest,
    weekDelta,
    stats,
    milestones,
    lastLoggedAt,
    chartData,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const weightChartRef = useRef<HTMLCanvasElement>(null);
  const bfChartRef = useRef<HTMLCanvasElement>(null);
  const bmiChartRef = useRef<HTMLCanvasElement>(null);
  const today = new Date().toISOString().split("T")[0];

  // ── Chart.js initialization ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (chartData.labels.length < 2) return;

    const charts: { destroy: () => void }[] = [];

    import("chart.js/auto").then((ChartModule) => {
      const Chart = ChartModule.default;

      const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, color: "#9ca3af", font: { size: 11 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            ticks: { color: "#9ca3af", font: { size: 11 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
        },
      };

      // ── Weight trend ──
      if (weightChartRef.current) {
        const ctx = weightChartRef.current.getContext("2d");
        if (ctx) {
          charts.push(new Chart(ctx, {
            type: "line",
            data: {
              labels: chartData.labels,
              datasets: [{
                label: "Weight (lbs)",
                data: chartData.weight,
                borderColor: "#10b981",
                backgroundColor: "rgba(16,185,129,0.07)",
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: "#10b981",
                tension: 0.35,
                fill: true,
                spanGaps: true,
              }],
            },
            options: {
              ...baseOptions,
              plugins: {
                ...baseOptions.plugins,
                tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} lbs` } },
              },
            },
          }));
        }
      }

      // ── Body Fat % trend ──
      const bfData = chartData.bodyFatPct.filter((v) => v !== null);
      if (bfChartRef.current && bfData.length >= 2) {
        const ctx = bfChartRef.current.getContext("2d");
        if (ctx) {
          charts.push(new Chart(ctx, {
            type: "line",
            data: {
              labels: chartData.labels,
              datasets: [{
                label: "Body Fat %",
                data: chartData.bodyFatPct,
                borderColor: "#f59e0b",
                backgroundColor: "rgba(245,158,11,0.07)",
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: "#f59e0b",
                tension: 0.35,
                fill: true,
                spanGaps: true,
              }],
            },
            options: {
              ...baseOptions,
              plugins: {
                ...baseOptions.plugins,
                tooltip: { callbacks: { label: (c) => ` ${c.parsed.y}%` } },
              },
              scales: {
                ...baseOptions.scales,
                y: {
                  ...baseOptions.scales.y,
                  ticks: { ...baseOptions.scales.y.ticks, callback: (v) => `${v}%` },
                },
              },
            },
          }));
        }
      }

      // ── BMI trend ──
      const bmiData = chartData.bmi.filter((v) => v !== null);
      if (bmiChartRef.current && bmiData.length >= 2) {
        const ctx = bmiChartRef.current.getContext("2d");
        if (ctx) {
          charts.push(new Chart(ctx, {
            type: "line",
            data: {
              labels: chartData.labels,
              datasets: [{
                label: "BMI",
                data: chartData.bmi,
                borderColor: "#818cf8",
                backgroundColor: "rgba(129,140,248,0.07)",
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: "#818cf8",
                tension: 0.35,
                fill: true,
                spanGaps: true,
              }],
            },
            options: {
              ...baseOptions,
              plugins: {
                ...baseOptions.plugins,
                tooltip: { callbacks: { label: (c) => ` BMI ${c.parsed.y}` } },
              },
            },
          }));
        }
      }
    });

    return () => charts.forEach((c) => c.destroy());
  }, [chartData]);

  const hasChartData = chartData.labels.length >= 2;
  const hasBfChart = chartData.bodyFatPct.filter((v) => v !== null).length >= 2;
  const hasBmiChart = chartData.bmi.filter((v) => v !== null).length >= 2;

  return (
    <div className="vault-progress">

      {/* ── Header ── */}
      <div className="vault-hero">
        <div>
          <h1 className="vault-title">Biometric Progress Engine</h1>
          <p className="vault-sub">
            Your metabolic command center, {firstName}.{" "}
            {lastLoggedAt && (
              <span className="vault-last-log">
                Last logged: {new Date(lastLoggedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </p>
        </div>
        <div className="vault-tier-badge">
          {vault.coachingTier === "weekly-zoom"
            ? "Weekly Zoom"
            : vault.coachingTier === "biweekly-zoom"
            ? "Bi-Weekly Zoom"
            : "AI Coach"}
        </div>
      </div>

      {/* ── Action Feedback ── */}
      {actionData && "message" in actionData && (
        <div className={`action-banner ${"error" in actionData ? "banner-error" : "banner-success"}`}>
          {"message" in actionData ? (actionData as { message: string }).message : (actionData as { error: string }).error}
        </div>
      )}
      {actionData && "error" in actionData && !("message" in actionData) && (
        <div className="action-banner banner-error">
          {(actionData as { error: string }).error}
        </div>
      )}

      {/* ── Stats Cards ── */}
      <div className="stats-row">
        <StatCard
          label="Current Weight"
          value={stats.latestWeight ? `${stats.latestWeight} lbs` : "—"}
          sub={weekDelta !== null ? `${weekDelta > 0 ? "+" : ""}${weekDelta} lbs this week` : undefined}
          subClass={weekDelta !== null ? (weekDelta < 0 ? "sub-down" : "sub-up") : undefined}
        />
        <StatCard
          label="Total Lost"
          value={stats.totalLost !== null && stats.totalLost > 0 ? `${stats.totalLost} lbs` : "—"}
          highlight
        />
        <StatCard
          label="Goal Weight"
          value={stats.goalWeight ? `${stats.goalWeight} lbs` : "Not set"}
        />
        <StatCard
          label="Remaining to Goal"
          value={stats.toGoal !== null ? (stats.toGoal > 0 ? `${stats.toGoal} lbs` : "Goal reached! 🎉") : "—"}
        />
        <StatCard
          label="Current BMI"
          value={stats.latestBmi ? String(stats.latestBmi) : "—"}
          sub={stats.latestBmi ? bmiCategory(stats.latestBmi) : undefined}
        />
        <StatCard
          label="Body Fat %"
          value={stats.latestBodyFatPct ? `${stats.latestBodyFatPct}%` : "—"}
        />
      </div>

      {/* ── Body Composition Summary Panel ── */}
      {latest && (
        <div className="vault-card composition-panel">
          <h2>Body Composition Summary</h2>
          <div className="composition-grid">
            <CompItem
              label="Muscle Mass"
              lbs={latest.muscleLbs}
              pct={latest.musclePct}
              color="#10b981"
            />
            <CompItem
              label="Lean Mass"
              lbs={latest.leanMassLbs}
              pct={latest.leanMassPct}
              color="#818cf8"
            />
            <CompItem
              label="Body Fat"
              lbs={latest.bodyFatLbs}
              pct={latest.bodyFatPct}
              color="#f59e0b"
            />
            <div className="comp-item">
              <span className="comp-label">Total Body Water</span>
              <span className="comp-value" style={{ color: "#38bdf8" }}>
                {latest.totalBodyWaterPct ? `${latest.totalBodyWaterPct}%` : "—"}
              </span>
            </div>
            <div className="comp-item">
              <span className="comp-label">Visceral Fat Score</span>
              <span
                className="comp-value"
                style={{ color: visceralFatColor(latest.visceralFat) }}
              >
                {latest.visceralFat ?? "—"}
                {latest.visceralFat && (
                  <span className="comp-sub"> {visceralFatLabel(latest.visceralFat)}</span>
                )}
              </span>
            </div>
            <div className="comp-item">
              <span className="comp-label">BMI</span>
              <span className="comp-value" style={{ color: "#818cf8" }}>
                {latest.bmi ?? "—"}
                {latest.bmi && (
                  <span className="comp-sub"> {bmiCategory(latest.bmi)}</span>
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Milestones ── */}
      {milestones.length > 0 && (
        <div className="milestones-bar">
          <span className="milestones-label">🏆 Milestones Achieved:</span>
          {milestones.map((m) => (
            <span key={m} className="milestone-chip">{m}</span>
          ))}
        </div>
      )}

      {/* ── Charts ── */}
      {hasChartData && (
        <div className="charts-grid">
          <div className="chart-card">
            <h3>Weight Trend</h3>
            <p className="chart-sub">lbs over time</p>
            <div className="chart-wrapper">
              <canvas ref={weightChartRef} />
            </div>
          </div>
          {hasBfChart && (
            <div className="chart-card">
              <h3>Body Fat % Trend</h3>
              <p className="chart-sub">percentage over time</p>
              <div className="chart-wrapper">
                <canvas ref={bfChartRef} />
              </div>
            </div>
          )}
          {hasBmiChart && (
            <div className="chart-card">
              <h3>BMI Trend</h3>
              <p className="chart-sub">body mass index over time</p>
              <div className="chart-wrapper">
                <canvas ref={bmiChartRef} />
              </div>
            </div>
          )}
        </div>
      )}

      {!hasChartData && entries.length === 1 && (
        <div className="chart-placeholder">
          Log at least 2 entries to unlock your progress charts.
        </div>
      )}

      {/* ── Log Entry Form ── */}
      <div className="vault-card">
        <h2>Log Biometrics</h2>
        <p className="card-sub">
          Enter your measurements from your InBody, Tanita, or other body composition scale.
          Only weight is required — log what you have.
        </p>
        <Form method="post" className="biometric-form">
          <input type="hidden" name="intent" value="log_biometric" />

          <fieldset className="form-section">
            <legend>Core Measurements</legend>
            <div className="form-grid-4">
              <FormField
                label="Date *"
                id="date"
                name="date"
                type="date"
                defaultValue={today}
                required
              />
              <FormField
                label="Weight (lbs) *"
                id="weight"
                name="weight"
                type="number"
                step="0.1"
                min="50"
                max="700"
                required
                placeholder="e.g. 185.5"
              />
              <FormField
                label="BMI"
                id="bmi"
                name="bmi"
                type="number"
                step="0.1"
                min="10"
                max="70"
                placeholder="Auto-calc or enter"
              />
              <FormField
                label="Visceral Fat Score"
                id="visceralFat"
                name="visceralFat"
                type="number"
                step="1"
                min="1"
                max="59"
                placeholder="1–59"
              />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Body Composition</legend>
            <div className="form-grid-3">
              <FormField
                label="Body Fat (lbs)"
                id="bodyFatLbs"
                name="bodyFatLbs"
                type="number"
                step="0.1"
                placeholder="e.g. 42.5"
              />
              <FormField
                label="Body Fat %"
                id="bodyFatPct"
                name="bodyFatPct"
                type="number"
                step="0.1"
                min="1"
                max="70"
                placeholder="e.g. 28.3"
              />
              <div className="form-spacer" />
              <FormField
                label="Muscle (lbs)"
                id="muscleLbs"
                name="muscleLbs"
                type="number"
                step="0.1"
                placeholder="e.g. 120.0"
              />
              <FormField
                label="Muscle %"
                id="musclePct"
                name="musclePct"
                type="number"
                step="0.1"
                min="1"
                max="80"
                placeholder="e.g. 64.8"
              />
              <div className="form-spacer" />
              <FormField
                label="Lean Mass (lbs)"
                id="leanMassLbs"
                name="leanMassLbs"
                type="number"
                step="0.1"
                placeholder="e.g. 135.0"
              />
              <FormField
                label="Lean Mass %"
                id="leanMassPct"
                name="leanMassPct"
                type="number"
                step="0.1"
                min="1"
                max="99"
                placeholder="e.g. 72.9"
              />
              <FormField
                label="Total Body Water %"
                id="totalBodyWaterPct"
                name="totalBodyWaterPct"
                type="number"
                step="0.1"
                min="1"
                max="80"
                placeholder="e.g. 53.4"
              />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Circumference Measurements (optional)</legend>
            <div className="form-grid-4">
              <FormField
                label="Waist (in)"
                id="waist"
                name="waist"
                type="number"
                step="0.25"
                placeholder="e.g. 34.5"
              />
              <FormField
                label="Hips (in)"
                id="hips"
                name="hips"
                type="number"
                step="0.25"
                placeholder="e.g. 40.0"
              />
              <FormField
                label="Chest (in)"
                id="chest"
                name="chest"
                type="number"
                step="0.25"
                placeholder="e.g. 38.0"
              />
              <FormField
                label="Neck (in)"
                id="neck"
                name="neck"
                type="number"
                step="0.25"
                placeholder="e.g. 14.5"
              />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Notes</legend>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="How are you feeling? Compliance notes, sleep, stress, cravings, energy levels..."
              className="form-textarea"
            />
          </fieldset>

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Log Biometrics"}
          </button>
        </Form>
      </div>

      {/* ── Profile / Goals ── */}
      <div className="vault-card">
        <h2>Profile &amp; Goals</h2>
        <p className="card-sub">
          Set your starting weight, goal weight, and height. Height is used to auto-calculate BMI.
        </p>
        <Form method="post" className="goals-form">
          <input type="hidden" name="intent" value="set_goals" />
          <div className="form-grid-4">
            <FormField
              label="Start Weight (lbs)"
              id="startWeight"
              name="startWeight"
              type="number"
              step="0.1"
              defaultValue={stats.startWeight ?? ""}
              placeholder="Your weight when you started"
            />
            <FormField
              label="Goal Weight (lbs)"
              id="goalWeight"
              name="goalWeight"
              type="number"
              step="0.1"
              defaultValue={stats.goalWeight ?? ""}
              placeholder="Your target weight"
            />
            <div className="form-group">
              <label>Height</label>
              <div className="height-row">
                <input
                  type="number"
                  name="heightFt"
                  min="3"
                  max="8"
                  placeholder="ft"
                  defaultValue={
                    stats.heightInches ? Math.floor(stats.heightInches / 12) : ""
                  }
                  className="form-input height-ft"
                />
                <span className="height-sep">ft</span>
                <input
                  type="number"
                  name="heightIn"
                  min="0"
                  max="11"
                  placeholder="in"
                  defaultValue={
                    stats.heightInches ? stats.heightInches % 12 : ""
                  }
                  className="form-input height-in"
                />
                <span className="height-sep">in</span>
              </div>
            </div>
          </div>
          <button type="submit" className="btn-secondary" disabled={isSubmitting}>
            Save Profile
          </button>
        </Form>
      </div>

      {/* ── History Table ── */}
      {entries.length > 0 && (
        <div className="vault-card">
          <h2>Progress History</h2>
          <p className="card-sub">{entries.length} {entries.length === 1 ? "entry" : "entries"} — most recent first</p>
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Weight</th>
                  <th title="Change from previous entry">Δ</th>
                  <th>BMI</th>
                  <th>Visceral Fat</th>
                  <th>BF (lbs)</th>
                  <th>BF %</th>
                  <th>Muscle (lbs)</th>
                  <th>Muscle %</th>
                  <th>Lean (lbs)</th>
                  <th>Lean %</th>
                  <th>TBW %</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const prev = entries[idx + 1];
                  const delta =
                    prev ? entry.weight - prev.weight : null;
                  return (
                    <tr key={`${entry.date}-${idx}`}>
                      <td className="date-cell">{entry.date}</td>
                      <td className="weight-cell">
                        <strong>{entry.weight}</strong>
                      </td>
                      <td
                        className={
                          delta === null
                            ? "delta-cell"
                            : delta < 0
                            ? "delta-cell down"
                            : delta > 0
                            ? "delta-cell up"
                            : "delta-cell"
                        }
                      >
                        {delta === null
                          ? "—"
                          : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                      </td>
                      <td>{entry.bmi ?? "—"}</td>
                      <td>{entry.visceralFat ?? "—"}</td>
                      <td>{entry.bodyFatLbs ?? "—"}</td>
                      <td>
                        {entry.bodyFatPct ? `${entry.bodyFatPct}%` : "—"}
                      </td>
                      <td>{entry.muscleLbs ?? "—"}</td>
                      <td>
                        {entry.musclePct ? `${entry.musclePct}%` : "—"}
                      </td>
                      <td>{entry.leanMassLbs ?? "—"}</td>
                      <td>
                        {entry.leanMassPct ? `${entry.leanMassPct}%` : "—"}
                      </td>
                      <td>
                        {entry.totalBodyWaterPct
                          ? `${entry.totalBodyWaterPct}%`
                          : "—"}
                      </td>
                      <td className="notes-cell">
                        {entry.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <div className="vault-empty">
          <p>No entries yet. Log your first biometrics above to start tracking your progress.</p>
        </div>
      )}
    </div>
  );
}

// ── Helper Functions ──────────────────────────────────────────────────────────

function bmiCategory(bmi: number): string {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

function visceralFatColor(score?: number): string {
  if (!score) return "#9ca3af";
  if (score <= 9) return "#10b981";
  if (score <= 14) return "#f59e0b";
  return "#ef4444";
}

function visceralFatLabel(score: number): string {
  if (score <= 9) return "(Healthy)";
  if (score <= 14) return "(High)";
  return "(Very High)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  subClass,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat-card${highlight ? " stat-card--highlight" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className={`stat-sub ${subClass ?? ""}`}>{sub}</span>}
    </div>
  );
}

function CompItem({
  label,
  lbs,
  pct,
  color,
}: {
  label: string;
  lbs?: number;
  pct?: number;
  color: string;
}) {
  return (
    <div className="comp-item">
      <span className="comp-label">{label}</span>
      <span className="comp-value" style={{ color }}>
        {lbs || pct
          ? [lbs ? `${lbs} lbs` : null, pct ? `${pct}%` : null]
              .filter(Boolean)
              .join(" / ")
          : "—"}
      </span>
    </div>
  );
}

function FormField({
  label,
  id,
  name,
  type = "text",
  required = false,
  defaultValue,
  ...rest
}: {
  label: string;
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  [key: string]: unknown;
}) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="form-input"
        {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    </div>
  );
}
