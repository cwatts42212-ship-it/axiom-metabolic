/**
 * Axiom Metabolic — AI Coach Chat Interface
 * Route: /account/coach
 *
 * The AI Coach has full access to the client's Biometric Vault data.
 * It uses buildAIVaultSummary() to inject current biometrics into every
 * new conversation thread, so the coach always knows where the client stands.
 *
 * Escalation: messages containing sensitive keywords are flagged and
 * a human-review notification is logged.
 */

import { redirect } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { useRef, useEffect, useState } from "react";
import { getVaultData, getCustomerGidByEmail, buildAIVaultSummary } from "~/lib/shopify/vault";
import { sendCoachMessage, detectMaintenanceMode } from "~/lib/openai/coach";
import { trackEvent } from "~/lib/klaviyo/sms";

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ context }: LoaderFunctionArgs) {
  const { customerAccount } = context;
  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) return redirect("/account/login?redirect=/account/coach");

  const customer = await customerAccount.get();
  const email = customer?.customer?.emailAddress?.emailAddress ?? "";
  const firstName = customer?.customer?.firstName ?? "Client";
  const lastName = customer?.customer?.lastName ?? "";

  const customerGid = await getCustomerGidByEmail(email);
  const vault = customerGid ? await getVaultData(customerGid) : null;
  const aiSummary = vault
    ? buildAIVaultSummary(vault, `${firstName} ${lastName}`.trim())
    : null;

  const latestWeight = vault?.entries?.[0]?.weight ?? null;
  const goalWeight = vault?.goalWeight ?? null;
  const isMaintenanceMode =
    goalWeight !== null && latestWeight !== null
      ? latestWeight <= goalWeight
      : detectMaintenanceMode(aiSummary ?? undefined);

  return Response.json({
    firstName,
    email,
    customerGid,
    hasVaultData: !!vault && (vault.entries?.length ?? 0) > 0,
    aiSummary,
    coachingTier: vault?.coachingTier ?? "ai-only",
    latestWeight,
    goalWeight,
    isMaintenanceMode,
    totalLost:
      vault?.startWeight && latestWeight
        ? parseFloat((vault.startWeight - latestWeight).toFixed(1))
        : null,
  });
}

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ request, context }: ActionFunctionArgs) {
  const { customerAccount } = context;
  const isLoggedIn = await customerAccount.isLoggedIn();
  if (!isLoggedIn) return redirect("/account/login");

  const formData = await request.formData();
  const userMessage = (formData.get("message") as string)?.trim();
  const threadId = (formData.get("threadId") as string) || undefined;
  const vaultSummary = (formData.get("vaultSummary") as string) || undefined;
  const goalWeightRaw = formData.get("goalWeight") as string;
  const currentWeightRaw = formData.get("currentWeight") as string;
  const goalWeight = goalWeightRaw ? parseFloat(goalWeightRaw) : undefined;
  const currentWeight = currentWeightRaw ? parseFloat(currentWeightRaw) : undefined;

  if (!userMessage) {
    return Response.json({ error: "Message cannot be empty." }, { status: 400 });
  }

  const customer = await customerAccount.get();
  const firstName = customer?.customer?.firstName ?? "Client";

  try {
    const response = await sendCoachMessage({
      userMessage,
      threadId,
      customerName: firstName,
      vaultSummary: !threadId ? vaultSummary : undefined,
      goalWeight: !threadId ? goalWeight : undefined,
      currentWeight: !threadId ? currentWeight : undefined,
    });

    // Log escalation and fire Klaviyo event for human coach review
    if (response.escalate) {
      console.warn(
        `[ESCALATION] Customer: ${firstName} | Reason: ${response.escalationReason} | Message: ${userMessage}`
      );
      const customer2 = await customerAccount.get();
      const customerEmail = customer2?.customer?.emailAddress?.emailAddress ?? "";
      const customerPhone = customer2?.customer?.phoneNumber?.phoneNumber ?? "";
      // Notify the client their message is being reviewed
      await trackEvent({
        event_name: "Axiom AI Escalation",
        customer_properties: { email: customerEmail, phone_number: customerPhone },
        properties: {
          first_name: firstName,
          escalation_reason: response.escalationReason,
          last_message: userMessage,
          message: `${firstName}, your message has been flagged for review by your human coach. You will hear back within 24 hours.`,
        },
      }).catch(console.error);
      // Notify the human coach (coach email from env)
      const coachEmail = process.env.COACH_EMAIL;
      if (coachEmail) {
        await trackEvent({
          event_name: "Axiom Coach Escalation Alert",
          customer_properties: { email: coachEmail },
          properties: {
            client_name: firstName,
            client_email: customerEmail,
            escalation_reason: response.escalationReason,
            last_message: userMessage,
            action_required: "Follow up with client within 24 hours",
          },
        }).catch(console.error);
      }
    }

    return Response.json({
      reply: response.message,
      threadId: response.threadId,
      escalated: response.escalate,
    });
  } catch (err) {
    console.error("AI Coach error:", err);
    return Response.json(
      { error: "The coach is temporarily unavailable. Please try again in a moment." },
      { status: 500 }
    );
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  escalated?: boolean;
}

export default function CoachChat() {
  const { firstName, hasVaultData, aiSummary, coachingTier, latestWeight, goalWeight, isMaintenanceMode, totalLost } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: isMaintenanceMode
        ? `Welcome back, ${firstName}! 🎉 You've reached your goal weight — this is the Lead Nutrition Coach. We're now in Maintenance Mode, focused on Metabolic Flexibility and keeping you there permanently. What's on your mind today?`
        : `Hey ${firstName}! This is your Lead Nutrition Coach at Axiom Metabolic. ${
            hasVaultData
              ? `I can see your latest data — you're currently at ${latestWeight} lbs${totalLost ? ` and you've lost ${totalLost} lbs total. That's real progress — let's keep building on it!` : "."}`
              : "I don't see any biometrics logged yet — head to the Progress tab to log your first entry so I can give you personalized coaching."
          } What can I help you with today?`,
    },
  ]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle action response
  useEffect(() => {
    if (!actionData) return;

    if ("reply" in actionData && actionData.reply) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: actionData.reply as string,
          escalated: (actionData as { escalated?: boolean }).escalated,
        },
      ]);
      if ((actionData as { threadId?: string }).threadId) {
        setThreadId((actionData as { threadId?: string }).threadId);
      }
    }

    if ("error" in actionData && actionData.error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${actionData.error}`,
        },
      ]);
    }
  }, [actionData]);

  const handleSubmit = (e: React.FormEvent) => {
    if (!inputValue.trim()) {
      e.preventDefault();
      return;
    }
    setMessages((prev) => [...prev, { role: "user", content: inputValue }]);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !isSubmitting) {
        (e.currentTarget.closest("form") as HTMLFormElement)?.requestSubmit();
      }
    }
  };

  return (
    <div className="coach-chat">

      {/* ── Header ── */}
      <div className="coach-header">
        <div className="coach-avatar">🧠</div>
        <div>
          <h1 className="coach-title">Axiom AI Coach</h1>
          <p className="coach-status">
            <span className="status-dot" />
            Online · {coachingTier === "ai-only" ? "AI-Only Plan" : coachingTier === "biweekly-zoom" ? "Bi-Weekly Zoom Plan" : "Weekly Zoom Plan"}
          </p>
        </div>
        {hasVaultData && (
          <div className="coach-vault-badge">
            📊 Vault Connected
          </div>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-bubble chat-bubble--${msg.role}`}>
            {msg.role === "assistant" && (
              <span className="bubble-avatar">🧠</span>
            )}
            <div className="bubble-content">
              <p>{msg.content}</p>
              {msg.escalated && (
                <p className="escalation-notice">
                  ⚠️ This has been flagged for human coach review.
                </p>
              )}
            </div>
          </div>
        ))}
        {isSubmitting && (
          <div className="chat-bubble chat-bubble--assistant">
            <span className="bubble-avatar">🧠</span>
            <div className="bubble-content typing-indicator">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Form ── */}
      <Form method="post" className="chat-input-form" onSubmit={handleSubmit}>
        <input type="hidden" name="threadId" value={threadId ?? ""} />
        <input type="hidden" name="vaultSummary" value={aiSummary ?? ""} />
        <input type="hidden" name="goalWeight" value={goalWeight ?? ""} />
        <input type="hidden" name="currentWeight" value={latestWeight ?? ""} />
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            name="message"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach anything... (Enter to send, Shift+Enter for new line)"
            rows={2}
            className="chat-textarea"
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={isSubmitting || !inputValue.trim()}
          >
            {isSubmitting ? "..." : "Send"}
          </button>
        </div>
        <p className="chat-hint">
          Your coach has access to your biometric data and will personalize every response.
          {coachingTier !== "ai-only" && " Your human coach also reviews flagged conversations."}
        </p>
      </Form>
    </div>
  );
}
