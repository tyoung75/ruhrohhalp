export const AI_MODELS = {
  // Primary brain: synthesis, briefings, CEO mode, agent chat
  PRIMARY: "claude-sonnet-4-6",
  // Fast path: command bar intent detection, lightweight classification
  FAST: "claude-haiku-4-5-20251001",
  // Audit layer (Groq/Llama — replaces GPT)
  AUDIT: "meta-llama/llama-4-scout-17b-16e-instruct",
  // Embeddings (Hugging Face/BGE-M3 — replaces OpenAI)
  EMBEDDING_MODEL: "BAAI/bge-m3",
} as const;
