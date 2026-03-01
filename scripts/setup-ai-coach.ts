/**
 * Axiom Metabolic — AI Coach Setup Script
 *
 * Creates the OpenAI Assistant with the Axiom coaching persona.
 * Run this ONCE (or to update the assistant after adding training files).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/setup-ai-coach.ts
 *
 * After running, copy the printed ASSISTANT_ID into your .env file:
 *   OPENAI_ASSISTANT_ID=asst_...
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AXIOM_COACH_SYSTEM_PROMPT = `
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
- How to read biometric data (weight, BMI, visceral fat, body fat %, muscle %, lean mass, total body water)
- The Axiom Metabolic coaching tiers: AI-only, Bi-weekly Zoom, Weekly Zoom

WHAT YOU DO:
1. Answer protocol questions with confidence and specificity
2. Celebrate milestones (5 lbs, 10 lbs, etc.) with genuine enthusiasm
3. Troubleshoot plateaus by asking targeted questions about compliance
4. Reference the client's specific biometric data when it is provided in context
5. Remind clients to log their biometrics in the Vault
6. Encourage upgrading to a higher coaching tier when appropriate
7. Flag complex medical or emotional issues for human escalation

WHAT YOU NEVER DO:
- Give specific medical advice or diagnose conditions
- Tell clients to stop their medication
- Make promises about specific weight loss timelines
- Be dismissive of struggles — always validate before redirecting

When a client seems to be in distress or has a medical concern, always say:
"I want to make sure you get the best support — I'm flagging this for your human coach to follow up personally."

Keep responses under 200 words unless a detailed explanation is genuinely needed.
`.trim();

async function uploadTrainingFiles(): Promise<string[]> {
  const trainingDir = path.join(process.cwd(), "training-data");
  if (!fs.existsSync(trainingDir)) {
    console.log("No training-data/ directory found. Skipping file upload.");
    console.log("To add training files: create training-data/ and add .txt files with coaching messages.");
    return [];
  }

  const files = fs.readdirSync(trainingDir).filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
  if (files.length === 0) {
    console.log("No .txt or .md files found in training-data/. Skipping.");
    return [];
  }

  const fileIds: string[] = [];
  for (const filename of files) {
    const filepath = path.join(trainingDir, filename);
    console.log(`Uploading training file: ${filename}...`);
    const uploaded = await openai.files.create({
      file: fs.createReadStream(filepath),
      purpose: "assistants",
    });
    fileIds.push(uploaded.id);
    console.log(`  ✅ Uploaded: ${uploaded.id}`);
  }

  return fileIds;
}

async function main() {
  console.log("\n🧠 Setting up Axiom Metabolic AI Coach...\n");

  // Upload training files if present
  const fileIds = await uploadTrainingFiles();

  // Create vector store if we have files
  let vectorStoreId: string | undefined;
  if (fileIds.length > 0) {
    console.log("\nCreating vector store for training files...");
    const vectorStore = await openai.beta.vectorStores.create({
      name: "Axiom Metabolic Coaching Knowledge Base",
      file_ids: fileIds,
    });
    vectorStoreId = vectorStore.id;
    console.log(`✅ Vector store created: ${vectorStoreId}`);
  }

  // Create the assistant
  console.log("\nCreating OpenAI Assistant...");
  const assistant = await openai.beta.assistants.create({
    name: "Axiom Metabolic Coach",
    instructions: AXIOM_COACH_SYSTEM_PROMPT,
    model: "gpt-4.1-mini",
    tools: fileIds.length > 0 ? [{ type: "file_search" }] : [],
    ...(vectorStoreId
      ? {
          tool_resources: {
            file_search: { vector_store_ids: [vectorStoreId] },
          },
        }
      : {}),
  });

  console.log(`\n✅ Assistant created successfully!`);
  console.log(`\nAssistant ID: ${assistant.id}`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Add this to your .env file:`);
  console.log(`OPENAI_ASSISTANT_ID=${assistant.id}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
