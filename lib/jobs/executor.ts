import { createAdminClient } from "@/lib/supabase/admin";

type JobResult = {
  ok: boolean;
  [key: string]: unknown;
};

type JobFn = () => Promise<JobResult>;

/**
 * Idempotent job executor with retry and dead-letter support.
 *
 * Usage:
 *   return runJob("score-tasks", jobFn, { idempotencyKey: "score-2026-03-28" });
 */
export async function runJob(
  jobType: string,
  fn: JobFn,
  opts?: { idempotencyKey?: string; maxRetries?: number },
): Promise<JobResult> {
  const supabase = createAdminClient();
  const maxRetries = opts?.maxRetries ?? 3;

  // Check idempotency — skip if same key already completed
  if (opts?.idempotencyKey) {
    const { data: existing } = await supabase
      .from("job_runs")
      .select("id, status, result")
      .eq("idempotency_key", opts.idempotencyKey)
      .in("status", ["completed", "running"])
      .maybeSingle();

    if (existing) {
      if (existing.status === "completed") {
        return (existing.result as JobResult) ?? { ok: true, cached: true };
      }
      // Already running — don't double-execute
      return { ok: true, skipped: true, reason: "already_running" };
    }
  }

  // Create job_run record
  const { data: jobRun, error: insertError } = await supabase
    .from("job_runs")
    .insert({
      job_type: jobType,
      status: "running",
      idempotency_key: opts?.idempotencyKey ?? null,
      max_retries: maxRetries,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !jobRun) {
    return { ok: false, error: insertError?.message ?? "Failed to create job_run" };
  }

  const jobId = jobRun.id;

  // Execute with retries
  let lastError: string | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      // Mark completed
      await supabase
        .from("job_runs")
        .update({
          status: "completed",
          result,
          retries: attempt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      await supabase
        .from("job_runs")
        .update({
          retries: attempt + 1,
          error: lastError,
        })
        .eq("id", jobId);

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // All retries exhausted → dead letter
  await supabase
    .from("job_runs")
    .update({
      status: "dead_letter",
      error: lastError,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return { ok: false, error: lastError, dead_letter: true };
}
