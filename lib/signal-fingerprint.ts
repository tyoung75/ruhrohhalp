/**
 * Builds a fuzzy fingerprint from signal text for deduplication.
 *
 * Strategy: extract meaningful terms, normalize, sort alphabetically,
 * and join. This means "Your NVDA position is up 5% today" and
 * "NVDA position gained 5% this session" produce the same fingerprint
 * because they share the same key terms.
 *
 * Stop words, numbers, and very short words are stripped so that
 * date/time variations and minor rewording don't change the fingerprint.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "up", "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "as", "until", "while", "if",
  "or", "and", "but", "yet", "this", "that", "these", "those",
  "it", "its", "you", "your", "he", "she", "his", "her", "they",
  "their", "we", "our", "my", "me", "him", "them", "us",
  "today", "tomorrow", "yesterday", "now", "currently", "recently",
]);

export function buildFingerprint(text: string): string {
  const tokens = text
    .toLowerCase()
    // Remove punctuation except hyphens within words
    .replace(/[^\w\s-]/g, " ")
    // Split on whitespace
    .split(/\s+/)
    // Remove stop words, pure numbers, and very short words
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
    // Deduplicate
    .filter((t, i, arr) => arr.indexOf(t) === i)
    // Sort for order-independence
    .sort();

  return tokens.join("|");
}

/**
 * Checks if a signal text matches any of the given dismissal fingerprints.
 * Returns true if the signal should be suppressed.
 */
export function isSignalDismissed(
  signalText: string,
  dismissedFingerprints: Set<string>
): boolean {
  const fp = buildFingerprint(signalText);
  if (dismissedFingerprints.has(fp)) return true;

  // Fuzzy: check if the signal's fingerprint is a superset of any dismissal
  // (i.e., the dismissed topic's key terms all appear in this signal)
  const signalTerms = new Set(fp.split("|"));
  for (const dismissedFp of dismissedFingerprints) {
    const dismissedTerms = dismissedFp.split("|");
    // If ≥80% of the dismissed signal's terms appear in this signal, suppress it
    if (dismissedTerms.length === 0) continue;
    const matchCount = dismissedTerms.filter((t) => signalTerms.has(t)).length;
    const matchRatio = matchCount / dismissedTerms.length;
    if (matchRatio >= 0.8) return true;
  }

  return false;
}
