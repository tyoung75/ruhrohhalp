type GoogleOauthCredentials = {
  clientId: string;
  clientSecret: string;
};

/**
 * Pick a valid Google OAuth client ID/secret pair without mixing stale env vars.
 *
 * Production currently carries both GOOGLE_* and YOUTUBE_* names for the same
 * Google OAuth client. Prefer complete namespace pairs first, then only allow a
 * cross-namespace fallback if the client IDs are identical.
 */
export function getGoogleOauthCredentials(): GoogleOauthCredentials | null {
  const googleId = process.env.GOOGLE_CLIENT_ID ?? null;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET ?? null;
  const youtubeId = process.env.YOUTUBE_CLIENT_ID ?? null;
  const youtubeSecret = process.env.YOUTUBE_CLIENT_SECRET ?? null;

  if (youtubeId && youtubeSecret) {
    return { clientId: youtubeId, clientSecret: youtubeSecret };
  }

  if (googleId && googleSecret) {
    return { clientId: googleId, clientSecret: googleSecret };
  }

  const idsMatch = Boolean(googleId && youtubeId && googleId === youtubeId);

  if (googleId && youtubeSecret && idsMatch) {
    return { clientId: googleId, clientSecret: youtubeSecret };
  }

  if (youtubeId && googleSecret && idsMatch) {
    return { clientId: youtubeId, clientSecret: googleSecret };
  }

  return null;
}
