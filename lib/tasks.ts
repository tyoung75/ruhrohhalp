import type { PlannerItem } from "@/lib/types/domain";
import type { Database } from "@/lib/types/db";

export function dbTaskToPlannerItem(row: Database["public"]["Tables"]["tasks"]["Row"]): PlannerItem {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    howTo: row.how_to,
    recommendedAI: row.recommended_ai,
    recommendedModel: row.recommended_model,
    aiReason: row.ai_reason,
    selectedModel: row.selected_model,
    auditNotes: row.audit_notes,
    memoryKey: row.memory_key,
    status: row.status,
    sourceText: row.source_text,
    projectId: row.project_id,
    delegatedTo: row.delegated_to,
    isOpenLoop: row.is_open_loop,
    threadRef: row.thread_ref,
    leverageReason: row.leverage_reason,
    githubPrUrl: row.github_pr_url,
    linearIssueId: row.linear_issue_id,
    linearUrl: row.linear_url,
    linearSyncedAt: row.linear_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
