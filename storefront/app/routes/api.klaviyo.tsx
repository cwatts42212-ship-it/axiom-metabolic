/**
 * Axiom Metabolic — Klaviyo SMS API Route
 * Route: POST /api/klaviyo
 *
 * Internal API endpoint called by:
 *  - Vault save (milestone detection, log reminders)
 *  - Order webhook (welcome SMS, order shipped)
 *  - Scheduled jobs (inactivity alerts, weigh-in reminders)
 *  - AI Coach (escalation alerts)
 *
 * All requests must include X-Axiom-Internal header for security.
 */


import type { ActionFunctionArgs } from "@shopify/hydrogen";
import {
  triggerInactivityAlert,
  triggerMilestoneCelebration,
  triggerWeighInReminder,
  triggerTierUpgradePrompt,
  triggerOrderFulfilled,
} from "~/lib/klaviyo/sms";

export async function action({ request }: ActionFunctionArgs) {
  // Basic internal security check
  const internalHeader = request.headers.get("X-Axiom-Internal");
  if (internalHeader !== process.env.SESSION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    trigger: string;
    email: string;
    phone?: string;
    firstName: string;
    [key: string]: unknown;
  };

  const { trigger, email, phone, firstName } = body;

  if (!trigger || !email || !firstName) {
    return Response.json({ error: "Missing required fields: trigger, email, firstName" }, { status: 400 });
  }

  try {
    switch (trigger) {
      case "inactivity_alert":
        await triggerInactivityAlert(
          email,
          phone ?? "",
          firstName,
          (body.daysSinceLastLog as number) ?? 7
        );
        break;

      case "milestone_celebration":
        await triggerMilestoneCelebration(
          email,
          phone ?? "",
          firstName,
          (body.poundsLost as number) ?? 5
        );
        break;

      case "weigh_in_reminder":
        await triggerWeighInReminder(email, phone ?? "", firstName);
        break;

      case "tier_upgrade_prompt":
        await triggerTierUpgradePrompt(
          email,
          phone ?? "",
          firstName,
          (body.currentTier as string) ?? "ai-only"
        );
        break;

      case "order_fulfilled":
        await triggerOrderFulfilled(
          email,
          phone ?? "",
          firstName,
          (body.orderNumber as string) ?? ""
        );
        break;

      default:
        return Response.json({ error: `Unknown trigger: ${trigger}` }, { status: 400 });
    }

    return Response.json({ success: true, trigger });
  } catch (err) {
    console.error("[KLAVIYO ROUTE] Error:", err);
    return Response.json(
      { error: "Klaviyo event failed. Check server logs." },
      { status: 500 }
    );
  }
}
