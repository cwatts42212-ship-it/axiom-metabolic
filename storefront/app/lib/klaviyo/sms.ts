/**
 * Axiom Metabolic — Klaviyo SMS Integration
 * Handles automated SMS triggers based on Vault data events:
 * - Inactivity alerts (no log in 7+ days)
 * - Milestone celebrations (5, 10, 15, 20+ lbs lost)
 * - Weekly weigh-in reminders
 * - Coaching tier upgrade prompts
 */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";

interface KlaviyoProfile {
  email: string;
  phone_number?: string;
  first_name?: string;
  last_name?: string;
  properties?: Record<string, unknown>;
}

interface KlaviyoEvent {
  event_name: string;
  customer_properties: { email: string; phone_number?: string };
  properties?: Record<string, unknown>;
}

async function klaviyoRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  body?: unknown
): Promise<unknown> {
  const privateKey = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!privateKey) throw new Error("KLAVIYO_PRIVATE_API_KEY is not set");

  const response = await fetch(`${KLAVIYO_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Klaviyo-API-Key ${privateKey}`,
      "Content-Type": "application/json",
      revision: "2024-10-15",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Klaviyo API error ${response.status}: ${text}`);
  }

  return response.status === 204 ? null : response.json();
}

/** Create or update a Klaviyo profile */
export async function upsertProfile(profile: KlaviyoProfile): Promise<void> {
  await klaviyoRequest("/profiles/", "POST", {
    data: {
      type: "profile",
      attributes: {
        email: profile.email,
        phone_number: profile.phone_number,
        first_name: profile.first_name,
        last_name: profile.last_name,
        properties: profile.properties ?? {},
      },
    },
  });
}

/** Track a custom event in Klaviyo (triggers flows) */
export async function trackEvent(event: KlaviyoEvent): Promise<void> {
  await klaviyoRequest("/events/", "POST", {
    data: {
      type: "event",
      attributes: {
        metric: {
          data: {
            type: "metric",
            attributes: { name: event.event_name },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: event.customer_properties,
          },
        },
        properties: event.properties ?? {},
        time: new Date().toISOString(),
      },
    },
  });
}

// ── Specific SMS Trigger Functions ──────────────────────────────────────────

/** Fire when a client hasn't logged in 7+ days */
export async function triggerInactivityAlert(
  email: string,
  phone: string,
  firstName: string,
  daysSinceLastLog: number
): Promise<void> {
  await trackEvent({
    event_name: "Axiom Vault Inactivity",
    customer_properties: { email, phone_number: phone },
    properties: {
      first_name: firstName,
      days_since_last_log: daysSinceLastLog,
      message: `Hey ${firstName}! It's been ${daysSinceLastLog} days since your last weigh-in. Jump into the Vault and log your weight — your progress matters! 💪`,
    },
  });
}

/** Fire when a client hits a weight loss milestone */
export async function triggerMilestoneCelebration(
  email: string,
  phone: string,
  firstName: string,
  poundsLost: number
): Promise<void> {
  const messages: Record<number, string> = {
    5: `🎉 ${firstName}, you've lost 5 lbs! That's real progress — keep going!`,
    10: `🔥 ${firstName}, 10 lbs DOWN! You are doing the work. So proud of you!`,
    15: `⚡ ${firstName}, 15 lbs gone FOREVER! You're unstoppable!`,
    20: `🏆 ${firstName}, 20 lbs lost! This is a MAJOR milestone. Let's keep this momentum!`,
    25: `🌟 ${firstName}, 25 lbs! You've completely transformed your body. Amazing!`,
    30: `💎 ${firstName}, 30 lbs lost! You are an Axiom success story!`,
  };

  const message = messages[poundsLost] ?? `🎉 ${firstName}, you've lost ${poundsLost} lbs! Incredible work!`;

  await trackEvent({
    event_name: "Axiom Milestone Achieved",
    customer_properties: { email, phone_number: phone },
    properties: {
      first_name: firstName,
      pounds_lost: poundsLost,
      message,
    },
  });
}

/** Weekly weigh-in reminder (triggered by scheduled job) */
export async function triggerWeighInReminder(
  email: string,
  phone: string,
  firstName: string
): Promise<void> {
  await trackEvent({
    event_name: "Axiom Weekly Weigh-In Reminder",
    customer_properties: { email, phone_number: phone },
    properties: {
      first_name: firstName,
      message: `Good morning ${firstName}! Time to step on the scale and log your weekly weigh-in in the Vault. Your data = your power! 📊`,
    },
  });
}

/** Prompt a client to upgrade their coaching tier */
export async function triggerTierUpgradePrompt(
  email: string,
  phone: string,
  firstName: string,
  currentTier: string
): Promise<void> {
  await trackEvent({
    event_name: "Axiom Tier Upgrade Prompt",
    customer_properties: { email, phone_number: phone },
    properties: {
      first_name: firstName,
      current_tier: currentTier,
      message: `${firstName}, you're crushing it! Ready to level up with live Zoom coaching? Reply YES and we'll get you set up. 🚀`,
    },
  });
}

/** Notify client when order is fulfilled and shipped */
export async function triggerOrderFulfilled(
  email: string,
  phone: string,
  firstName: string,
  orderNumber: string
): Promise<void> {
  await trackEvent({
    event_name: "Axiom Order Fulfilled",
    customer_properties: { email, phone_number: phone },
    properties: {
      first_name: firstName,
      order_number: orderNumber,
      message: `${firstName}, your Axiom Metabolic order #${orderNumber} is on its way! Your protocol foods are coming. Stay on track! 📦`,
    },
  });
}
