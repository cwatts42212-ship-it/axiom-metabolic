# Deploying to Shopify Oxygen

Shopify Oxygen is the recommended hosting platform for Hydrogen storefronts. It provides a serverless environment that is optimized for Remix, globally distributed, and integrates directly with your Shopify store.

---

### Step 1: Create the Hydrogen Sales Channel

1.  In your Shopify Admin, go to **Sales Channels** in the left sidebar.
2.  Click **"Add sales channel"**.
3.  Find **"Hydrogen"** in the list and click the **"+"** button to install it.
4.  Once installed, you will see a new **Hydrogen** item in your sales channels list. Click it.

---

### Step 2: Create a New Storefront

1.  Inside the Hydrogen sales channel, click **"Create storefront"**.
2.  Give your storefront a name (e.g., "Axiom Metabolic Production").
3.  You will be prompted to connect a GitHub repository.

---

### Step 3: Connect Your GitHub Repository

1.  Push the `axiom-metabolic` codebase to a new repository on your GitHub account.
2.  In the Hydrogen storefront setup, click **"Connect repository"**.
3.  Authorize Shopify to access your GitHub account and select the repository you just created.
4.  Shopify will automatically detect that it is a Hydrogen project.

---

### Step 4: Configure Production Environment Variables

This is the most critical step. Your deployed application needs access to the same API keys and secrets as your local environment.

1.  In your new Oxygen storefront settings, navigate to **"Environment variables"**.
2.  For **each variable** in your local `/storefront/.env` file, you must add it here as a secret.
    -   Click **"Add variable"**.
    -   Enter the variable **Name** (e.g., `SESSION_SECRET`).
    -   Enter the variable **Value** (e.g., `your-production-session-secret`).
    -   **DO NOT** check the "Public" box for any secret variables like API keys.

    **You must add all of these:**

    -   `SESSION_SECRET` (generate a new random string for production)
    -   `PUBLIC_STORE_DOMAIN`
    -   `PUBLIC_STOREFRONT_API_TOKEN`
    -   `SHOPIFY_ADMIN_API_TOKEN`
    -   `OPENAI_API_KEY`
    -   `KLAVIYO_PRIVATE_API_KEY`
    -   `KLAVIYO_PUBLIC_API_KEY`
    -   `VENDOR_EMAIL` or `VENDOR_WEBHOOK_URL`
    -   `SHOPIFY_WEBHOOK_SECRET` (generate a new random string)

---

### Step 5: Trigger Your First Deployment

1.  Once your repository is connected and environment variables are set, deployments are triggered automatically on every `git push` to your main branch.
2.  Make a small change to your code (e.g., update text in the `README.md`), commit it, and push it to GitHub.

    ```bash
    git add .
    git commit -m "Trigger initial deployment"
    git push origin main
    ```

3.  In the Hydrogen channel, you will see the deployment start. It typically takes 2-3 minutes.
4.  Once complete, Shopify will provide you with a production URL (e.g., `https://your-storefront-name.hydrogen.shop`).

---

### Step 6: Final Configuration (Post-Deployment)

Your app is live, but you need to run the setup script to configure production webhooks.

1.  **Get your production URL** from the Hydrogen channel details.
2.  **Run the setup script locally**, but point it to your production environment by setting the `PRODUCTION_URL` environment variable.

    ```bash
    # Run this from your local machine
    SHOPIFY_ADMIN_API_TOKEN=YOUR_SHOPIFY_ADMIN_API_TOKEN \
    PRODUCTION_URL=https://your-production-url.hydrogen.shop \
    npx tsx scripts/setup-store.ts
    ```

3.  This will register the `orders/paid` webhook to point to your live application endpoint (`/api/webhooks/orders`).

Your deployment is now complete. Refer to the main `README.md` for the final post-deployment checklist (importing products, publishing coaching tiers, etc.).
