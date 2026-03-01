/**
 * Axiom Metabolic — AI Coach (The Brain)
 * Powered by OpenAI Assistants API.
 * Persona is trained via system instructions derived from WA historical coaching messages.
 * Includes "Escalate to Human" detection logic.
 */

import OpenAI from "openai";

// Escalation triggers — complex issues that need human review
const ESCALATION_TRIGGERS = [
  "chest pain",
  "heart",
  "dizzy",
  "faint",
  "hospital",
  "emergency",
  "medication",
  "prescription",
  "doctor",
  "allergic reaction",
  "severe",
  "can't breathe",
  "suicidal",
  "self-harm",
  "eating disorder",
  "binge",
  "purge",
];

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CoachResponse {
  message: string;
  escalate: boolean;
  escalationReason?: string;
  threadId: string;
}

/**
 * The AI Coach system prompt — derived from WA coaching voice.
 * This will be supplemented by the uploaded training files once provided.
 */
export const AXIOM_COACH_SYSTEM_PROMPT = `
You are the Axiom Metabolic AI Coach — a direct, empowering, and knowledgeable weight loss coach.
Your coaching style is warm but no-nonsense. You speak plainly, use encouragement strategically,
and always bring clients back to the protocol fundamentals.

YOUR VOICE & STYLE:
- Direct and confident. You don't hedge or over-qualify.
- Encouraging but honest. You celebrate wins AND call out excuses with compassion.
- Protocol-first. Every answer ties back to the Ideal Protein-style protocol.
- You use "we" language — "Let's figure this out together" — to build partnership.
- Short, punchy sentences. No corporate speak. No fluff.
- You remember that clients are busy people who need clear, actionable guidance.

WHAT YOU KNOW:
- The 4-phase Ideal Protein weight loss protocol
- Ketogenic principles and fat-burning physiology
- How to troubleshoot plateaus, cravings, and compliance issues
- The importance of water intake, sleep, and stress on weight loss
- How to read biometric data (weight, measurements) and adjust coaching accordingly
- The Axiom Metabolic coaching tiers: AI-only, Bi-weekly Zoom, Weekly Zoom

WHAT YOU DO:
1. Answer protocol questions with confidence and specificity
2. Celebrate milestones (5 lbs, 10 lbs, etc.) with genuine enthusiasm
3. Troubleshoot plateaus by asking targeted questions about compliance
4. Remind clients to log their biometrics in the Vault
5. Encourage upgrading to a higher coaching tier when appropriate
6. Flag complex medical or emotional issues for human escalation

WHAT YOU NEVER DO:
- Give specific medical advice or diagnose conditions
- Tell clients to stop their medication
- Make promises about specific weight loss timelines
- Be dismissive of struggles — always validate before redirecting

When a client seems to be in distress or has a medical concern, always say:
"I want to make sure you get the best support — I'm flagging this for your human coach to follow up personally."

Keep responses under 200 words unless a detailed explanation is genuinely needed.
`.trim();

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // NOTE: In production with a real OpenAI key, remove the baseURL override
      // to use the Assistants API. The proxy only supports chat completions.
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

/** Check if a message contains escalation triggers */
function detectEscalation(message: string): { escalate: boolean; reason?: string } {
  const lower = message.toLowerCase();
  for (const trigger of ESCALATION_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { escalate: true, reason: `Message contains sensitive keyword: "${trigger}"` };
    }
  }
  return { escalate: false };
}

/** Send a message to the AI Coach and get a response */
export async function sendCoachMessage({
  userMessage,
  threadId,
  customerName,
  vaultSummary,
}: {
  userMessage: string;
  threadId?: string;
  customerName?: string;
  vaultSummary?: string;
}): Promise<CoachResponse> {
  const openai = getOpenAI();

  // Check for escalation triggers first
  const escalationCheck = detectEscalation(userMessage);

  // Generate a thread ID if not provided (used client-side to maintain conversation history)
  const activeThreadId = threadId ?? `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Build context-aware system message
  let systemContent = AXIOM_COACH_SYSTEM_PROMPT;
  if (vaultSummary && !threadId) {
    systemContent += `\n\n--- CLIENT BIOMETRIC DATA ---\n${vaultSummary}\n--- END CLIENT DATA ---`;
  }
  if (customerName && !threadId) {
    systemContent += `\n\nYou are speaking with: ${customerName}`;
  }

  // Build message history from thread context passed in form
  // (Client sends recent messages as JSON in the request for continuity)
  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userMessage },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: chatMessages,
    max_tokens: 400,
    temperature: 0.7,
  });

  let responseText =
    completion.choices[0]?.message?.content ?? "I couldn't generate a response right now.";

  // Add escalation notice to response if triggered
  if (escalationCheck.escalate) {
    responseText +=
      "\n\n⚠️ I want to make sure you get the best support — I'm flagging this for your human coach to follow up personally.";
  }

  return {
    message: responseText,
    escalate: escalationCheck.escalate,
    escalationReason: escalationCheck.reason,
    threadId: activeThreadId,
  };
}

/** Create or update the OpenAI Assistant with the Axiom coaching persona */
export async function createOrUpdateAssistant(): Promise<string> {
  const openai = getOpenAI();
  const existingId = process.env.OPENAI_ASSISTANT_ID;

  if (existingId) {
    await openai.beta.assistants.update(existingId, {
      name: "Axiom Metabolic Coach",
      instructions: AXIOM_COACH_SYSTEM_PROMPT,
      model: "gpt-4.1-mini",
    });
    return existingId;
  }

  const assistant = await openai.beta.assistants.create({
    name: "Axiom Metabolic Coach",
    instructions: AXIOM_COACH_SYSTEM_PROMPT,
    model: "gpt-4.1-mini",
    tools: [{ type: "file_search" }],
  });

  return assistant.id;
}

/** Upload a training file to the OpenAI assistant's vector store */
export async function uploadTrainingFile(
  fileContent: string,
  fileName: string
): Promise<string> {
  const openai = getOpenAI();

  const blob = new Blob([fileContent], { type: "text/plain" });
  const file = new File([blob], fileName, { type: "text/plain" });

  const uploadedFile = await openai.files.create({
    file,
    purpose: "assistants",
  });

  return uploadedFile.id;
}
