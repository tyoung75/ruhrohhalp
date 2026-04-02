import { callClaude } from "@/lib/processors/claude";
import { encodeMessage, getGmailClient } from "@/lib/google/gmail";
import type { ReplyClassification } from "@/lib/types/brands";

function decodeBody(data?: string): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export async function searchForBrandReplies(contactEmails: string[]) {
  const gmail = getGmailClient();
  if (!gmail || contactEmails.length === 0) return [];

  const query = `from:(${contactEmails.map((e) => e.trim()).join(" OR ")}) newer_than:2d`;
  const listed = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 20 });
  const ids = listed.data.messages ?? [];

  const replies = await Promise.all(
    ids.map(async (message: { id?: string | null }) => {
      if (!message.id) return null;
      const full = await gmail.users.messages.get({ userId: "me", id: message.id, format: "full" });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h: { name?: string | null; value?: string | null }) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const from = headers.find((h: { name?: string | null; value?: string | null }) => h.name?.toLowerCase() === "from")?.value ?? "";
      const textPart = full.data.payload?.parts?.find((p: { mimeType?: string | null; body?: { data?: string | null } }) => p.mimeType === "text/plain") ?? full.data.payload;
      return {
        from,
        subject,
        body: decodeBody(textPart?.body?.data),
        threadId: full.data.threadId ?? "",
        messageId: full.data.id ?? "",
      };
    }),
  );

  return replies.filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export async function createBrandDraft(to: string, subject: string, body: string) {
  const gmail = getGmailClient();
  if (!gmail) return { draftId: null, messageId: null };

  const raw = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");

  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodeMessage(raw),
      },
    },
  });

  return {
    draftId: created.data.id ?? null,
    messageId: created.data.message?.id ?? null,
  };
}

export async function classifyReply(subject: string, body: string): Promise<ReplyClassification> {
  const system = "Classify brand outreach replies. Return only one label: genuine_interest, auto_reply, redirect_to_form, product_seeding_offer, decline.";
  const user = `Subject: ${subject}\n\nBody:\n${body}`;
  const answer = (await callClaude(system, user, 64)).trim().toLowerCase();
  const valid: ReplyClassification[] = ["genuine_interest", "auto_reply", "redirect_to_form", "product_seeding_offer", "decline"];
  return valid.find((v) => answer.includes(v)) ?? "genuine_interest";
}
