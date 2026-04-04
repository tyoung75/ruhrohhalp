import { google } from "googleapis";
import { getGoogleOauthCredentials } from "@/lib/google/oauth";

export function getGmailClient() {
  // GOOGLE_REFRESH_TOKEN is minted via /api/auth/gmail which uses the
  // GOOGLE_* OAuth client. Prefer those credentials explicitly so we
  // don't accidentally use YOUTUBE_* client (which may lack Gmail scopes).
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: "v1", auth: oauth2Client });
  }

  // Fall back to shared resolver
  const oauth = getGoogleOauthCredentials();
  if (!oauth || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export function encodeMessage(raw: string): string {
  return Buffer.from(raw).toString("base64url");
}
