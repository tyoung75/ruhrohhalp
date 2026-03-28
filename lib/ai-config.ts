export const AI_MODELS = {
  // Primary brain: synthesis, briefings, CEO mode, agent chat
  PRIMARY: "claude-sonnet-4-6",
  // Fast path: command bar intent detection, lightweight classification
  FAST: "claude-haiku-4-5-20251001",
  // Audit layer (Groq/Llama — replaces GPT)
  AUDIT: "meta-llama/llama-4-scout-17b-16e-instruct",
  // Embeddings (Hugging Face/BGE-M3 — replaces OpenAI)
  EMBEDDING_MODEL: "BAAI/bge-m3",
  // Opus-tier: platform intelligence, pattern extraction, CEO mode
  PLATFORM_INTELLIGENCE: "claude-opus-4-6",
  PATTERN_EXTRACTION: "claude-opus-4-6",
  CEO_MODE: "claude-opus-4-6",
  // Sonnet-tier: structured reasoning tasks
  BRIEFING: "claude-sonnet-4-6",
  TASK_SCORING: "claude-sonnet-4-6",
  LEVERAGE_REASON: "claude-sonnet-4-6",
  UNBLOCK_HINT: "claude-sonnet-4-6",
  WEIGHT_ANALYSIS: "claude-sonnet-4-6",
  // Haiku-tier: fast classification
  COMMAND_BAR: "claude-haiku-4-5-20251001",
} as const;
// Audit: Llama 4 Scout via Groq (raw fetch — not through callAI())
// Embeddings: BGE-M3 via Hugging Face
// Voice: Whisper-1 via OpenAI
