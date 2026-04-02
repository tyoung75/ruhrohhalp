import { google } from "googleapis";
import { getGoogleOauthCredentials } from "@/lib/google/oauth";

export function getGmailClient() {
  const oauth = getGoogleOauthCredentials();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

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
