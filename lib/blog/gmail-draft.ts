import { google } from "googleapis";
import type { BlogPost } from "@/lib/blog/types";
import { getGoogleOauthCredentials } from "@/lib/google/oauth";

function getGmailClient() {
  const oauth = getGoogleOauthCredentials();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!oauth || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

function encodeMessage(raw: string): string {
  return Buffer.from(raw).toString("base64url");
}

export async function createBlogDraftEmail(post: BlogPost, draftId: string, weekStartIso: string) {
  const gmail = getGmailClient();
  if (!gmail) return { ok: false as const, error: "gmail_not_configured" };

  const weekDate = weekStartIso.slice(0, 10);
  const subject = `[BDHE Dev Log] Here's What We Built — Week of ${weekDate} [${draftId}]`;
  const body = `${post.markdown}\n\n---\n\nInternal Draft ID: ${draftId}`;
  const raw = [`Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");

  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodeMessage(raw),
      },
    },
  });

  return {
    ok: true as const,
    draftId: created.data.id ?? null,
    messageId: created.data.message?.id ?? null,
    subject,
  };
}

export async function checkSentDraft(draftId: string) {
  const gmail = getGmailClient();
  if (!gmail) return { sent: false, reason: "gmail_not_configured" };

  const draftResult = await gmail.users.drafts.get({ userId: "me", id: draftId }).catch(() => null);
  if (draftResult?.data?.id) {
    return { sent: false, reason: "still_in_drafts" };
  }

  const sent = await gmail.users.messages.list({
    userId: "me",
    maxResults: 25,
    q: `[${draftId}] in:sent`,
  });

  const message = sent.data.messages?.[0];
  if (!message?.id) return { sent: false, reason: "not_found_in_sent" };

  const full = await gmail.users.messages.get({ userId: "me", id: message.id, format: "full" });
  const payload = full.data.payload;
  const textPart = payload?.parts?.find((p: Record<string, unknown>) => p.mimeType === "text/plain") ?? payload;
  const edited = textPart?.body?.data ? Buffer.from(textPart.body.data, "base64").toString("utf8") : "";

  return {
    sent: true,
    sentMessageId: message.id,
    editedMarkdown: edited,
  };
}
