# Klaviyo SMS Flow Setup

This document provides instructions for creating the necessary SMS automation Flows in Klaviyo. The Axiom Metabolic application sends events to Klaviyo; these Flows listen for those events and send the corresponding SMS messages.

---

### Before You Start

1.  **Enable SMS**: Ensure SMS is enabled in your Klaviyo account (`Settings` > `SMS`).
2.  **Get API Keys**: You will need your **Private API Key** and **Public API Key**. Find these under `Account` > `Settings` > `API Keys`.
3.  **Add Keys to `.env`**: Add these keys to your `.env` file in the `/storefront` directory and to your production environment variables in Shopify Oxygen.

---

### Creating a Klaviyo Flow

For each trigger below, you will create a new Flow in Klaviyo:

1.  Go to the **Flows** tab in Klaviyo.
2.  Click **"Create Flow"**.
3.  Click **"Create from Scratch"**.
4.  Give the Flow a name (e.g., "Axiom - Milestone Celebration").
5.  For the trigger, select **"Metric"**.
6.  From the dropdown, choose **"API"** as the trigger source.
7.  In the "Metric Name" field, enter the exact `Event Name` specified below.

---

### Required Flows & SMS Templates

Create one Flow for each of the following events.

#### 1. Welcome SMS

-   **Flow Name**: `Axiom - Coaching Welcome`
-   **Trigger Metric Name**: `axiom_coaching_welcome`
-   **SMS Message Template**:

    ```
    Welcome to Axiom Metabolic, {{ person.first_name }}! Your {{ event.tier_name }} plan is active. Log into your dashboard to start tracking your progress: https://your-domain.com/account
    ```

#### 2. Weight Log Reminder

-   **Flow Name**: `Axiom - Weight Log Reminder`
-   **Trigger Metric Name**: `axiom_weight_log_reminder`
-   **SMS Message Template**:

    ```
    Hey {{ person.first_name }}! Time to log your weight and biometrics in your Axiom Vault. Consistency is your superpower. 💪
    ```

#### 3. Milestone Celebration

-   **Flow Name**: `Axiom - Milestone Celebration`
-   **Trigger Metric Name**: `axiom_milestone_hit`
-   **SMS Message Template**:

    ```
    🎉 {{ person.first_name }}, you just hit a {{ event.milestone_lbs }}-lb milestone! That is REAL progress. We are so proud of you. Keep going!
    ```

#### 4. Inactivity Alert

-   **Flow Name**: `Axiom - Inactivity Alert`
-   **Trigger Metric Name**: `axiom_inactivity_alert`
-   **SMS Message Template**:

    ```
    {{ person.first_name }}, we haven't seen you in {{ event.days_inactive }} days. Your goals are still waiting for you. Log in and let's get back on track together: https://your-domain.com/account
    ```

#### 5. Order Shipped

-   **Flow Name**: `Axiom - Order Shipped`
-   **Trigger Metric Name**: `axiom_order_shipped`
-   **SMS Message Template**:

    ```
    Your Axiom Metabolic order #{{ event.order_number }} is on its way! {% if event.tracking_number %}Track it here: {{ event.tracking_number }}{% endif %}
    ```

---

### How It Works

-   The Hydrogen application uses the `trackKlaviyoEvent` function (`/storefront/app/lib/klaviyo/sms.ts`) to send these events.
-   The `event_name` in the code must exactly match the **Trigger Metric Name** you configure in the Klaviyo Flow.
-   The properties sent with the event (e.g., `tier_name`, `milestone_lbs`) are available in your SMS templates using Klaviyo's template syntax (e.g., `{{ event.property_name }}`).
-   Customer information is available via `{{ person.property_name }}`.
