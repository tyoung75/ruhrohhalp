/**
 * POST /api/brain/reembed
 *
 * Re-embeds all rows with NULL embeddings across all knowledge tables
 * using BGE-M3 (1024-dim). Protected by webhook secret or user auth.
 *
 * Body (optional):
 *   { tables?: string[], batchSize?: number, userId?: string }
 *
 * - tables: subset of tables to re-embed (default: all 8)
 * - batchSize: rows per batch (default: 50)
 * - userId: required for webhook calls, inferred for browser calls
 */

import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateEmbeddings } from "@/lib/embedding/openai";
import { logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Table definitions: which column holds the text to embed
// ---------------------------------------------------------------------------

interface TableDef {
  table: string;
  /** SQL expression that produces the text to embed. */
  textColumn: string;
}

const ALL_TABLES: TableDef[] = [
  { table: "memories", textColumn: "content" },
  { table: "decisions", textColumn: "title || ' ' || description || ' ' || context || ' ' || reasoning" },
  { table: "projects", textColumn: "name || ' ' || description" },
  { table: "people", textColumn: "name || ' ' || coalesce(company,'') || ' ' || role || ' ' || notes" },
  { table: "ideas", textColumn: "title || ' ' || description" },
  { table: "meetings", textColumn: "title || ' ' || summary || ' ' || notes" },
  { table: "documents", textColumn: "title || ' ' || content" },
  { table: "goals", textColumn: "title || ' ' || coalesce(description,'')" },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Parse body once up front
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  // Auth: webhook secret OR logged-in user
  let userId: string | null = null;

  const webhookResult = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (webhookResult) {
    // Not a valid webhook — try user auth
    const { user, response } = await requireUser();
    if (response || !user) return response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    userId = user.id;
  } else {
    // Valid webhook — userId must be in body
    userId = (body.userId as string) ?? null;
  }

  try {
    const requestedTables = body.tables as string[] | undefined;
    const batchSize = Math.min((body.batchSize as number) ?? 50, 200);

    const tableDefs = requestedTables
      ? ALL_TABLES.filter((t) => requestedTables.includes(t.table))
      : ALL_TABLES;

    const supabase = createAdminClient();
    const results: Record<string, { processed: number; errors: number; lastError: string }> = {};

    for (const def of tableDefs) {
      let processed = 0;
      let errors = 0;
      let lastStepError = "";

      // Fetch rows with null embeddings in batches
      while (true) {
        let query = supabase
          .from(def.table)
          .select("id")
          .is("embedding", null)
          .limit(batchSize);

        if (userId) {
          query = query.eq("user_id", userId);
        }

        const { data: rows, error: fetchError } = await query;

        if (fetchError) {
          logError(`reembed.fetch.${def.table}`, fetchError);
          lastStepError = `fetch: ${fetchError.message}`;
          errors++;
          break;
        }

        if (!rows || rows.length === 0) break;

        // Fetch the text content for these IDs
        const ids = rows.map((r: { id: string }) => r.id);

        // Skip RPC (get_text_for_embedding doesn't exist) — go straight to fallback
        const textRows = null;
        const textError = { message: "Using direct fetch fallback" };

        // Fallback: fetch raw columns and compute text in JS
        let textsToEmbed: { id: string; text: string }[] = [];

        if (textError || !textRows) {
          // Direct fetch approach
          const columnMap: Record<string, string[]> = {
            memories: ["id", "content"],
            decisions: ["id", "title", "description", "context", "reasoning"],
            projects: ["id", "name", "description"],
            people: ["id", "name", "company", "role", "notes"],
            ideas: ["id", "title", "description"],
            meetings: ["id", "title", "summary", "notes"],
            documents: ["id", "title", "content"],
            goals: ["id", "title", "description"],
          };

          const cols = columnMap[def.table] ?? ["id", "content"];
          const { data: rawRows, error: rawError } = await supabase
            .from(def.table)
            .select(cols.join(", "))
            .in("id", ids);

          if (rawError || !rawRows) {
            logError(`reembed.text.${def.table}`, rawError);
            lastStepError = `textFetch: ${rawError?.message ?? "no rows returned"}`;
            errors += ids.length;
            break;
          }

          textsToEmbed = (rawRows as unknown as Record<string, unknown>[]).map((row) => {
            const textParts = cols
              .filter((c) => c !== "id")
              .map((c) => (String(row[c] ?? "")).trim())
              .filter((s) => s.length > 0);
            return { id: String(row.id), text: textParts.join(" ") };
          });
        } else {
          textsToEmbed = (textRows as { id: string; text_content: string }[]).map((r) => ({
            id: r.id,
            text: r.text_content,
          }));
        }

        // Filter out empty texts
        const validRows = textsToEmbed.filter((r) => r.text.length > 0);
        if (validRows.length === 0) break;

        // Generate embeddings
        try {
          const embeddings = await generateEmbeddings(validRows.map((r) => r.text));

          // Update each row with its embedding
          for (let i = 0; i < validRows.length; i++) {
            const { error: updateError } = await supabase
              .from(def.table)
              .update({ embedding: JSON.stringify(embeddings[i]) })
              .eq("id", validRows[i].id);

            if (updateError) {
              logError(`reembed.update.${def.table}`, updateError, { id: validRows[i].id });
              errors++;
            } else {
              processed++;
            }
          }
        } catch (embedError) {
          logError(`reembed.embed.${def.table}`, embedError);
          lastStepError = `embed: ${embedError instanceof Error ? embedError.message : String(embedError)}`;
          errors += validRows.length;
          break;
        }
      }

      results[def.table] = { processed, errors, lastError: lastStepError };
    }

    const totalProcessed = Object.values(results).reduce((sum, r) => sum + r.processed, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

    return NextResponse.json({
      success: totalErrors === 0,
      totalProcessed,
      totalErrors,
      tables: results,
    });
  } catch (error) {
    logError("reembed.handler", error);
    console.error("[reembed]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Re-embedding failed", detail: message }, { status: 500 });
  }
}

// Also support GET for easy browser trigger
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const tableCounts: Record<string, number> = {};

  for (const def of ALL_TABLES) {
    const { count } = await supabase
      .from(def.table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("embedding", null);
    tableCounts[def.table] = count ?? 0;
  }

  const total = Object.values(tableCounts).reduce((sum, c) => sum + c, 0);

  return NextResponse.json({
    message: `${total} rows need re-embedding. POST to this endpoint to start.`,
    nullEmbeddings: tableCounts,
    total,
  });
}
