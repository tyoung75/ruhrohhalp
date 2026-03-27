import { z } from "zod";

export const processInputSchema = z.object({
  input: z.string().min(1).max(20_000),
});

export const taskPatchSchema = z.object({
  status: z.enum(["open", "done"]).optional(),
  selectedModel: z.string().max(120).nullable().optional(),
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(1_000).optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
});

export const agentChatSchema = z.object({
  taskId: z.string().uuid(),
  modelId: z.string().min(1).max(120),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(50),
});

export const checkoutSchema = z.object({
  tier: z.enum(["starter", "pro", "byok"]),
});
