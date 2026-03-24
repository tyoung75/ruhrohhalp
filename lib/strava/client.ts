/**
 * Strava API client for ruhrohhalp.
 *
 * Handles OAuth token refresh and provides typed access to the Strava v3 API.
 * Used by the daily cron to sync activities into the brain and by the content
 * generator to pull recent training data as creative context.
 *
 * Strava access tokens expire every ~6 hours, so every call refreshes first.
 */

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth/token";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string; // Run, Ride, WeightTraining, Walk, Hike, etc.
  sport_type: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  start_date: string; // ISO 8601
  start_date_local: string;
  timezone: string;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  achievement_count: number;
  kudos_count: number;
  comment_count: number;
  average_speed: number; // m/s
  max_speed: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
  calories?: number;
  description?: string;
  device_name?: string;
  workout_type?: number;
  average_cadence?: number;
  has_heartrate: boolean;
  pr_count: number;
  map?: { summary_polyline: string | null };
}

export interface StravaAthleteStats {
  recent_run_totals: StravaTotals;
  recent_ride_totals: StravaTotals;
  recent_swim_totals: StravaTotals;
  ytd_run_totals: StravaTotals;
  ytd_ride_totals: StravaTotals;
  ytd_swim_totals: StravaTotals;
  all_run_totals: StravaTotals;
  all_ride_totals: StravaTotals;
  all_swim_totals: StravaTotals;
}

interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
  achievement_count?: number;
}

export interface StravaAthlete {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  city: string;
  state: string;
  country: string;
  weight?: number; // kg
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let cachedTokens: StravaTokens | null = null;

/**
 * Refresh the Strava access token using the refresh token.
 * Strava tokens expire every ~6 hours so we refresh on every batch of calls.
 */
export async function refreshAccessToken(
  refreshToken?: string
): Promise<StravaTokens> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const rt = refreshToken ?? process.env.STRAVA_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !rt) {
    throw new Error("Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, or STRAVA_REFRESH_TOKEN");
  }

  const res = await fetch(STRAVA_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: rt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };

  return cachedTokens;
}

/**
 * Get a valid access token, refreshing if expired or not yet cached.
 */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedTokens && cachedTokens.expiresAt > now + 60) {
    return cachedTokens.accessToken;
  }
  const tokens = await refreshAccessToken(cachedTokens?.refreshToken);
  return tokens.accessToken;
}

/**
 * Make an authenticated GET request to the Strava API.
 */
async function stravaGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${STRAVA_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava API ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Fetch the authenticated athlete's profile.
 */
export async function getAthlete(): Promise<StravaAthlete> {
  return stravaGet<StravaAthlete>("/athlete");
}

/**
 * Fetch recent activities. Default: last 30 days, up to 50 activities.
 */
export async function getActivities(options?: {
  after?: number; // Unix timestamp
  before?: number;
  perPage?: number;
  page?: number;
}): Promise<StravaActivity[]> {
  const params: Record<string, string> = {
    per_page: String(options?.perPage ?? 50),
    page: String(options?.page ?? 1),
  };
  if (options?.after) params.after = String(options.after);
  if (options?.before) params.before = String(options.before);

  return stravaGet<StravaActivity[]>("/athlete/activities", params);
}

/**
 * Fetch athlete stats (recent / YTD / all-time run/ride/swim totals).
 */
export async function getAthleteStats(athleteId: number): Promise<StravaAthleteStats> {
  return stravaGet<StravaAthleteStats>(`/athletes/${athleteId}/stats`);
}

/**
 * Fetch a single activity with full details.
 */
export async function getActivity(activityId: number): Promise<StravaActivity> {
  return stravaGet<StravaActivity>(`/activities/${activityId}`);
}

// ---------------------------------------------------------------------------
// Convenience: summary for content generation
// ---------------------------------------------------------------------------

/** Meters → miles. */
const toMiles = (m: number) => (m / 1609.344).toFixed(1);
/** Seconds → "Xh Ym" or "Xm Ys". */
const toHMS = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
/** m/s → min/mile pace string. */
const toPace = (mps: number) => {
  if (!mps || mps === 0) return "N/A";
  const secPerMile = 1609.344 / mps;
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
};

/**
 * Build a human-readable summary of recent activities for content generation.
 * This is what gets injected into the Creator OS context window.
 */
export async function buildTrainingSummary(): Promise<{
  recentActivities: string[];
  weeklyStats: string;
  athleteId: number;
}> {
  const athlete = await getAthlete();
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
  const activities = await getActivities({ after: sevenDaysAgo, perPage: 30 });
  const stats = await getAthleteStats(athlete.id);

  // Format each activity into a concise line
  const recentActivities = activities.map((a) => {
    const date = new Date(a.start_date_local).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const parts = [`${date}: ${a.type} — "${a.name}"`];

    if (a.distance > 0) parts.push(`${toMiles(a.distance)} mi`);
    parts.push(toHMS(a.moving_time));
    if (a.type === "Run" && a.average_speed > 0) parts.push(toPace(a.average_speed));
    if (a.average_heartrate) parts.push(`${Math.round(a.average_heartrate)} avg HR`);
    if (a.total_elevation_gain > 10) parts.push(`${Math.round(a.total_elevation_gain * 3.281)}ft gain`);
    if (a.suffer_score) parts.push(`suffer: ${a.suffer_score}`);
    if (a.pr_count > 0) parts.push(`${a.pr_count} PR${a.pr_count > 1 ? "s" : ""}`);
    if (a.calories) parts.push(`${a.calories} cal`);

    return parts.join(" | ");
  });

  // Weekly running stats
  const recent = stats.recent_run_totals;
  const ytd = stats.ytd_run_totals;
  const weeklyStats = [
    `Recent 4-wk running: ${recent.count} runs, ${toMiles(recent.distance)} mi, ${toHMS(recent.moving_time)}`,
    `YTD running: ${ytd.count} runs, ${toMiles(ytd.distance)} mi, ${toHMS(ytd.moving_time)}`,
    `YTD elevation: ${Math.round(ytd.elevation_gain * 3.281)}ft`,
  ].join("\n");

  return { recentActivities, weeklyStats, athleteId: athlete.id };
}
