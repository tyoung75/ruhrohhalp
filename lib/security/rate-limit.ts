const bucket = new Map<string, { count: number; resetAt: number }>();

export function limitByKey(key: string, max: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = bucket.get(key);

  if (!entry || now > entry.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }

  if (entry.count >= max) {
    return { ok: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  bucket.set(key, entry);
  return { ok: true, retryAfterMs: 0 };
}
