/**
 * Axiom Metabolic — Inactivity Checker
 *
 * Run this on a schedule (daily via cron or Shopify Flow) to:
 *  1. Fetch all customers with the "axiom_customer" tag
 *  2. Check their last vault log date (stored in metafields)
 *  3. Fire Klaviyo inactivity alert if no log in 7+ days
 *
 * Schedule: Daily at 9am (configure in your deployment platform)
 * Usage: npx tsx scripts/check-inactivity.ts
 */

const STORE_DOMAIN = "axiom-metabolic.myshopify.com";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN ?? "YOUR_SHOPIFY_ADMIN_API_TOKEN";
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_API_KEY ?? "";
const INACTIVITY_THRESHOLD_DAYS = 7;

async function shopifyGraphQL(query: string, variables = {}) {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function klaviyoTrackEvent(eventName: string, profile: {
  email: string;
  phone_number?: string;
  first_name?: string;
}, properties: Record<string, unknown>) {
  if (!KLAVIYO_KEY) {
    console.warn("[KLAVIYO] No API key — skipping event:", eventName);
    return;
  }

  const res = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "revision": "2024-02-15",
      "Authorization": `Klaviyo-API-Key ${KLAVIYO_KEY}`,
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          properties,
          time: new Date().toISOString(),
          metric: { data: { type: "metric", attributes: { name: eventName } } },
          profile: { data: { type: "profile", attributes: profile } },
        },
      },
    }),
  });

  if (!res.ok) {
    console.error(`[KLAVIYO] Event failed (${res.status}):`, await res.text());
  }
}

async function checkInactiveCustomers() {
  console.log("🔍 Checking for inactive Axiom customers...\n");

  let cursor: string | null = null;
  let totalChecked = 0;
  let totalAlerted = 0;

  do {
    const data = await shopifyGraphQL(`
      query GetCustomers($cursor: String) {
        customers(first: 50, after: $cursor, query: "tag:axiom_customer") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            email
            phone
            firstName
            lastName
            tags
            metafield(namespace: "axiom_vault", key: "last_log_date") {
              value
            }
          }
        }
      }
    `, { cursor });

    const customers = data?.data?.customers?.nodes ?? [];

    for (const customer of customers) {
      totalChecked++;
      const lastLogDate = customer.metafield?.value;

      if (!lastLogDate) {
        // Never logged — check account creation date
        continue;
      }

      const daysSinceLog = Math.floor(
        (Date.now() - new Date(lastLogDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLog >= INACTIVITY_THRESHOLD_DAYS) {
        console.log(`⚠️  ${customer.firstName} ${customer.lastName} (${customer.email}) — ${daysSinceLog} days inactive`);

        await klaviyoTrackEvent(
          "Axiom Vault Inactivity",
          {
            email: customer.email,
            phone_number: customer.phone ?? undefined,
            first_name: customer.firstName,
          },
          {
            first_name: customer.firstName,
            days_since_last_log: daysSinceLog,
            last_log_date: lastLogDate,
            message: `Hey ${customer.firstName}! It's been ${daysSinceLog} days since your last weigh-in. Jump into the Vault and log your weight — your progress matters! 💪`,
          }
        );

        totalAlerted++;
      }
    }

    cursor = data?.data?.customers?.pageInfo?.hasNextPage
      ? data.data.customers.pageInfo.endCursor
      : null;
  } while (cursor);

  console.log(`\n✅ Inactivity check complete`);
  console.log(`   Customers checked: ${totalChecked}`);
  console.log(`   Alerts sent: ${totalAlerted}`);
}

async function sendWeeklyReminders() {
  console.log("\n📅 Sending weekly weigh-in reminders...\n");

  // Only run on Mondays (day 1)
  const today = new Date().getDay();
  if (today !== 1) {
    console.log("  Not Monday — skipping weekly reminders");
    return;
  }

  let cursor: string | null = null;
  let totalSent = 0;

  do {
    const data = await shopifyGraphQL(`
      query GetActiveCustomers($cursor: String) {
        customers(first: 50, after: $cursor, query: "tag:axiom_customer") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            email
            phone
            firstName
          }
        }
      }
    `, { cursor });

    const customers = data?.data?.customers?.nodes ?? [];

    for (const customer of customers) {
      await klaviyoTrackEvent(
        "Axiom Weekly Weigh-In Reminder",
        {
          email: customer.email,
          phone_number: customer.phone ?? undefined,
          first_name: customer.firstName,
        },
        {
          first_name: customer.firstName,
          message: `Good morning ${customer.firstName}! Time to step on the scale and log your weekly weigh-in in the Vault. Your data = your power! 📊`,
        }
      );
      totalSent++;
    }

    cursor = data?.data?.customers?.pageInfo?.hasNextPage
      ? data.data.customers.pageInfo.endCursor
      : null;
  } while (cursor);

  console.log(`  ✅ Weekly reminders sent: ${totalSent}`);
}

async function main() {
  console.log("🚀 Axiom Metabolic — SMS Automation Runner\n" + "=".repeat(40));
  await checkInactiveCustomers();
  await sendWeeklyReminders();
  console.log("\n" + "=".repeat(40));
  console.log("Done.");
}

main().catch(console.error);
