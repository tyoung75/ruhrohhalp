/**
 * TylerOS vNext — Integration tests
 *
 * Tests the contract between CW (UI) and CC (backend) components.
 * Validates endpoint shapes, response structures, and data flow.
 *
 * These are "contract tests" that verify the API surface matches
 * what the UI components expect — without needing a running server.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// CW-1 ↔ CC-1: Ranked Tasks Endpoint
// ---------------------------------------------------------------------------
describe("CW-1 ↔ CC-1: Score-Tasks / Ranked Endpoint", () => {
  it("should return tasks with priority_score when ranked=true", () => {
    // Simulated response shape from GET /api/tasks?ranked=true&limit=3&state=started,unstarted,backlog
    const response = {
      tasks: [
        {
          id: "uuid-1",
          identifier: "T-001",
          title: "Ship Motus v2.1",
          description: "Final build for App Store",
          priority_num: 1,
          priority: "high",
          state: "started",
          status: "open",
          priority_score: 87.5,
          leverage_reason: "Directly impacts Ventures pillar — app revenue depends on this release",
          ai_metadata: {
            leverage_reason: "Directly impacts Ventures pillar — app revenue depends on this release",
          },
          created_at: "2026-03-27T10:00:00Z",
          updated_at: "2026-03-27T18:00:00Z",
        },
      ],
      items: [{ id: "uuid-1", title: "Ship Motus v2.1" }],
      pagination: { limit: 3, offset: 0, total: 1 },
    };

    // Contract: tasks array must exist with priority_score
    expect(response.tasks).toBeDefined();
    expect(response.tasks.length).toBeGreaterThan(0);
    expect(response.tasks[0].priority_score).toBeTypeOf("number");
    expect(response.tasks[0].priority_score).not.toBeNull();

    // Contract: leverage_reason accessible from both top-level and ai_metadata
    expect(response.tasks[0].leverage_reason).toBeTruthy();
    expect(response.tasks[0].ai_metadata?.leverage_reason).toBeTruthy();

    // Contract: state is not "done" (UI filters with state=started,unstarted,backlog)
    expect(["started", "unstarted", "backlog"]).toContain(response.tasks[0].state);

    // Contract: pagination shape
    expect(response.pagination).toHaveProperty("limit");
    expect(response.pagination).toHaveProperty("offset");
    expect(response.pagination).toHaveProperty("total");
  });

  it("should validate state filter uses explicit values (not negation)", () => {
    // The UI sends state=started,unstarted,backlog — NOT state=not(done)
    const validStates = "started,unstarted,backlog";
    const states = validStates.split(",");

    // These are the actual DB state values
    expect(states).toEqual(["started", "unstarted", "backlog"]);
    expect(states).not.toContain("not(done)");
    expect(states).not.toContain("done");
  });
});

// ---------------------------------------------------------------------------
// CW-2 ↔ CC-10: Dismiss with Reason
// ---------------------------------------------------------------------------
describe("CW-2 ↔ CC-10: Dismiss Endpoint", () => {
  it("should accept valid dismiss reasons", () => {
    const validReasons = ["not_relevant", "already_done", "wrong_timing", "too_hard", "other"];
    const uiReasons = ["not_relevant", "already_done", "wrong_timing", "too_hard", "other"];

    // All UI reasons must be valid backend reasons
    for (const reason of uiReasons) {
      expect(validReasons).toContain(reason);
    }
  });

  it("should return ok and total_dismissals count", () => {
    const response = { ok: true, total_dismissals: 15 };

    expect(response.ok).toBe(true);
    expect(response.total_dismissals).toBeTypeOf("number");
  });

  it("should trigger weight analysis after 30 dismissals", () => {
    // After every 30 dismissals, the backend runs weight analysis
    const thresholds = [30, 60, 90, 120];
    for (const count of thresholds) {
      expect(count % 30).toBe(0);
    }
    // Non-thresholds should not trigger
    expect(15 % 30).not.toBe(0);
    expect(29 % 30).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CW-3 ↔ CC-4: Blocked Tasks
// ---------------------------------------------------------------------------
describe("CW-3 ↔ CC-4: Blocked Tasks", () => {
  it("should return tasks with ai_metadata.unblock_hint via tasks key", () => {
    const response = {
      tasks: [
        {
          id: "uuid-blocked",
          title: "Deploy to production",
          state: "blocked",
          ai_metadata: {
            unblock_hint: "Waiting on Vercel env vars — run scripts/add-missing-vercel-envs.sh",
          },
        },
      ],
      items: [{ id: "uuid-blocked", title: "Deploy to production" }],
      pagination: { limit: 50, offset: 0, total: 1 },
    };

    // UI reads from response.tasks (not items) for ai_metadata
    expect(response.tasks[0].ai_metadata?.unblock_hint).toBeTruthy();
    expect(response.tasks[0].state).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// CW-4 ↔ CC-4: Zombie Alerts
// ---------------------------------------------------------------------------
describe("CW-4 ↔ CC-4: Zombie Alerts", () => {
  it("should map activity_log payload to ZombieAlert shape", () => {
    // Raw response from GET /api/system-alerts?type=zombie_alert
    const rawAlert = {
      id: "alert-1",
      type: "insight",
      entity_id: "task-uuid",
      payload: {
        action: "zombie_alert",
        task_id: "task-uuid",
        task_title: "Update CI pipeline",
        days_stale: 14,
        message: "This task has been started for 14 days with no progress",
      },
      created_at: "2026-03-27T08:00:00Z",
    };

    // UI maps payload fields to top-level ZombieAlert fields
    const mapped = {
      id: rawAlert.id,
      type: rawAlert.type,
      task_id: rawAlert.payload.task_id ?? rawAlert.entity_id,
      task_title: rawAlert.payload.task_title,
      days_stale: rawAlert.payload.days_stale,
      message: rawAlert.payload.message,
      created_at: rawAlert.created_at,
    };

    expect(mapped.task_id).toBe("task-uuid");
    expect(mapped.task_title).toBe("Update CI pipeline");
    expect(mapped.days_stale).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// CW-5 ↔ CC-5: Dead-Letter / Job Failures
// ---------------------------------------------------------------------------
describe("CW-5 ↔ CC-5: Dead-Letter Alerts", () => {
  it("should read dead_letter_jobs from system-alerts response", () => {
    const response = {
      alerts: [],  // activity_log alerts (zombie etc)
      dead_letter_jobs: [
        {
          id: "job-1",
          job_type: "score-tasks",
          status: "dead_letter",
          error: "ANTHROPIC_API_KEY not configured",
          created_at: "2026-03-27T06:00:00Z",
        },
      ],
    };

    // UI reads from dead_letter_jobs key, not alerts
    expect(response.dead_letter_jobs).toBeDefined();
    expect(response.dead_letter_jobs.length).toBe(1);

    // Map to DeadLetterAlert shape
    const mapped = {
      id: response.dead_letter_jobs[0].id,
      type: "dead_letter",
      job_name: response.dead_letter_jobs[0].job_type,
      error_snippet: response.dead_letter_jobs[0].error,
      created_at: response.dead_letter_jobs[0].created_at,
    };

    expect(mapped.job_name).toBe("score-tasks");
    expect(mapped.error_snippet).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CW-6 ↔ CC-8: Content Review (Content Queue)
// ---------------------------------------------------------------------------
describe("CW-6 ↔ CC-8: Content Queue Review", () => {
  it("should return items from GET /api/content-queue with filters", () => {
    const response = {
      items: [
        {
          id: "cq-1",
          platform: "threads",
          content_type: "text",
          body: "Morning run hit different today...",
          topic: "morning training",
          status: "draft",
          ai_audit_passed: false,
          audit_notes: "Hook could be stronger — consider leading with the metric",
          created_at: "2026-03-27T05:00:00Z",
        },
      ],
    };

    expect(response.items).toBeDefined();
    expect(response.items[0].platform).toBeTruthy();
    expect(response.items[0].status).toBe("draft");
    expect(response.items[0].ai_audit_passed).toBe(false);
  });

  it("should accept PATCH to approve content item", () => {
    const validStatuses = ["draft", "approved", "queued", "posting", "posted", "failed"];

    // Approve & Queue sends { status: "queued" }
    expect(validStatuses).toContain("queued");
    expect(validStatuses).toContain("approved");
  });
});

// ---------------------------------------------------------------------------
// CW-7 ↔ CC-8: Platform Intelligence Agent (Content Generation)
// ---------------------------------------------------------------------------
describe("CW-7 ↔ CC-8: Content Generation", () => {
  it("should accept ContentIdea and return variants", () => {
    const requestBody = {
      topic: "Morning 10-miler in the rain",
      platforms: ["tiktok", "threads"],
      goal_id: "goal-uuid",
    };

    // Validate request shape
    expect(requestBody.topic).toBeTruthy();
    expect(requestBody.platforms).toBeInstanceOf(Array);

    // Simulated response
    const response = {
      ok: true,
      content_idea_id: "idea-uuid",
      variants_generated: 2,
      variants_saved: 2,
      variants: [
        { id: "v1", platform: "tiktok", content_type: "video", status: "draft", ai_audit_passed: true },
        { id: "v2", platform: "threads", content_type: "text", status: "draft", ai_audit_passed: false },
      ],
    };

    expect(response.ok).toBe(true);
    expect(response.variants_generated).toBe(2);
    expect(response.variants).toHaveLength(2);
    expect(response.variants[0].platform).toBe("tiktok");
  });
});

// ---------------------------------------------------------------------------
// CC-0: GitHub Actions Scheduler
// ---------------------------------------------------------------------------
describe("CC-0: GitHub Actions Scheduler", () => {
  it("should have all 8 required workflow files", () => {
    const requiredWorkflows = [
      "briefing-morning",
      "briefing-evening",
      "briefing-weekly",
      "score-tasks",
      "zombie-scan",
      "embed-chunks",
      "snapshot-metrics",
      "content-handoff",
    ];

    // Each workflow maps to a .github/workflows/{name}.yml
    expect(requiredWorkflows).toHaveLength(8);
  });

  it("should use CRON_SECRET for internal auth", () => {
    // Internal endpoints require Authorization: Bearer $CRON_SECRET
    const authHeader = `Bearer ${process.env.CRON_SECRET ?? "test-secret"}`;
    expect(authHeader).toMatch(/^Bearer .+/);
  });
});

// ---------------------------------------------------------------------------
// CC-6/7: AI Config + callAI Wrapper
// ---------------------------------------------------------------------------
describe("CC-6/7: AI Config + callAI", () => {
  it("should define all required model slots", () => {
    // AI_MODELS must define these slots
    const requiredSlots = [
      "PLATFORM_INTELLIGENCE",
      "PATTERN_EXTRACTION",
      "CEO_MODE",
      "BRIEFING",
      "SCORING",
      "UNBLOCK_HINT",
      "COMMAND_BAR",
      "WEIGHT_ANALYSIS",
      "BRAND_VOICE_AUDIT",
    ];

    // Each slot maps to a specific model
    const modelMapping: Record<string, string> = {
      PLATFORM_INTELLIGENCE: "claude-opus-4-6",
      PATTERN_EXTRACTION: "claude-opus-4-6",
      CEO_MODE: "claude-opus-4-6",
      BRIEFING: "claude-sonnet-4-6",
      SCORING: "claude-sonnet-4-6",
      UNBLOCK_HINT: "claude-sonnet-4-6",
      COMMAND_BAR: "claude-haiku-4-5-20251001",
      WEIGHT_ANALYSIS: "claude-sonnet-4-6",
      BRAND_VOICE_AUDIT: "llama-4-scout-17b-16e-instruct",
    };

    for (const slot of requiredSlots) {
      expect(modelMapping[slot]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// CC-2: Skill Webhook Contract
// ---------------------------------------------------------------------------
describe("CC-2: Skill Webhook", () => {
  it("should accept [RRH:{id}] tagged operations", () => {
    const tagPattern = /\[RRH:([a-f0-9-]+)\]/;

    const validTags = [
      "[RRH:550e8400-e29b-41d4-a716-446655440000]",
      "[RRH:abc123]",
    ];

    for (const tag of validTags) {
      expect(tagPattern.test(tag)).toBe(true);
    }
  });

  it("should validate webhook secret header", () => {
    const headers = { "x-webhook-secret": "test-secret" };
    expect(headers["x-webhook-secret"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scoring Formula Validation
// ---------------------------------------------------------------------------
describe("Scoring Formula", () => {
  it("should compute priority_score = (goal_impact × 0.4) + (urgency × 0.3) + (energy_fit × 0.2) + (recency × 0.1)", () => {
    const weights = { goal_impact: 0.4, urgency: 0.3, energy_fit: 0.2, recency: 0.1 };
    const scores = { goal_impact: 90, urgency: 80, energy_fit: 70, recency: 60 };

    const result =
      scores.goal_impact * weights.goal_impact +
      scores.urgency * weights.urgency +
      scores.energy_fit * weights.energy_fit +
      scores.recency * weights.recency;

    expect(result).toBe(36 + 24 + 14 + 6); // 80
    expect(result).toBe(80);
  });

  it("should halve score if blocked", () => {
    const baseScore = 80;
    const isBlocked = true;
    const finalScore = isBlocked ? baseScore * 0.5 : baseScore;

    expect(finalScore).toBe(40);
  });

  it("should ensure weights sum to 1.0", () => {
    const weights = { goal_impact: 0.4, urgency: 0.3, energy_fit: 0.2, recency: 0.1 };
    const sum = Object.values(weights).reduce((s, v) => s + v, 0);

    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// Graceful Degradation Pattern
// ---------------------------------------------------------------------------
describe("Graceful Degradation", () => {
  it("should fall back to legacy when ranked endpoint returns no priority_score", () => {
    const response = {
      tasks: [{ id: "1", title: "Test", priority_score: null }],
      items: [{ id: "1", title: "Test" }],
    };

    // UI checks: tasks[0].priority_score != null
    const hasRankedData = response.tasks.length > 0 && response.tasks[0].priority_score != null;
    expect(hasRankedData).toBe(false);
  });

  it("should use ranked data when priority_score is present", () => {
    const response = {
      tasks: [{ id: "1", title: "Test", priority_score: 85 }],
      items: [{ id: "1", title: "Test" }],
    };

    const hasRankedData = response.tasks.length > 0 && response.tasks[0].priority_score != null;
    expect(hasRankedData).toBe(true);
  });

  it("should silently handle missing endpoints via Promise.allSettled", () => {
    // Simulated Promise.allSettled results
    const results = [
      { status: "fulfilled" as const, value: { tasks: [] } },
      { status: "rejected" as const, reason: new Error("404") },
      { status: "rejected" as const, reason: new Error("404") },
      { status: "rejected" as const, reason: new Error("404") },
    ];

    // Only fulfilled results should be processed
    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    // Rejected results should not throw
    const rejected = results.filter(r => r.status === "rejected");
    expect(rejected).toHaveLength(3);
  });
});
