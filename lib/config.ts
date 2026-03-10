import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  API_KEY_ENCRYPTION_SECRET: z.string().min(32),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  const errs = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${errs}`);
}

export const env = parsed.data;
