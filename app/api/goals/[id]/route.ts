import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AI_MODELS } from '@/lib/ai-config';
import { logError } from '@/lib/logger';

// Pillar colors derived from name (pillars table has no color column)
const PILLAR_COLORS: Record<string, string> = {
  "Fitness & Athletics":   "#e07d4a",
  "Career & Instacart":    "#5d9ef8",
  "Ventures & BDHE":       "#41c998",
  "Financial":             "#f4c842",
  "Relationship & Family": "#ef7f7f",
  "Health & Recovery":     "#9ec8f5",
  "Content & Brand":       "#e07d4a",
  "Travel & Experiences":  "#6fcf9a",
  "Personal Growth":       "#5d9ef8",
  "Community & Impact":    "#41c998",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachPillarColor(goal: any) {
  if (goal?.pillar) {
    goal.pillar.color = PILLAR_COLORS[goal.pillar.name] ?? "#e07d4a";
  }
  return goal;
}

const PILLAR_SELECT = `
  *,
  pillar:pillar_id (
    id,
    name
  )
`;

// ---------------------------------------------------------------------------
// AI-powered goal suggestion
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateGoalSuggestion(goal: any, userPrompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const goalContext = JSON.stringify({
    title: goal.title,
    description: goal.description,
    progress_metric: goal.progress_metric,
    progress_current: goal.progress_current,
    progress_target: goal.progress_target,
    target_date: goal.target_date,
    status: goal.status,
    priority: goal.priority,
    methods: goal.methods,
    tags: goal.tags,
  }, null, 2);

  const updatableFields = [
    'title', 'description', 'progress_current', 'progress_target',
    'progress_metric', 'target_date', 'status', 'priority', 'methods', 'tags',
  ];

  const systemPrompt = `You are TylerOS, a personal AI assistant helping manage goals.

You will receive a goal's current state and a natural language instruction from the user. Your job is to interpret what the user wants to change and return a structured JSON response.

CRITICAL RULES:
- Parse the user's input EXACTLY. If they say their time is 3:22:16, use 3:22:16 — not 3:23:02 or any other value.
- If they say they want "Sub 3:05:00", use "3:05:00" or "Sub 3:05:00" as the target — do not round or adjust.
- Only propose changes to fields the user is actually asking to change.
- The updatable fields are: ${updatableFields.join(', ')}
- For time-based metrics (marathon, race times), keep the exact format the user provides.
- methods is a text array of short labels.
- tags is a text array.
- target_date format is YYYY-MM-DD.
- priority must be one of: critical, high, medium, low.
- status must be one of: active, paused, completed, archived.

Respond with ONLY valid JSON matching this schema:
{
  "reasoning": "Brief explanation of what you understood and what you're changing",
  "proposed_changes": { /* only the fields being changed, with their new values */ },
  "downstream_effects": ["effect 1", "effect 2"]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODELS.FAST,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Current goal state:\n${goalContext}\n\nUser instruction: ${userPrompt}`,
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `AI call failed (${res.status})`);
  }

  const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';

  // Extract JSON from the response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON');
  }

  const suggestion = JSON.parse(jsonMatch[0]);

  // Validate: only allow known fields in proposed_changes
  if (suggestion.proposed_changes) {
    for (const key of Object.keys(suggestion.proposed_changes)) {
      if (!updatableFields.includes(key)) {
        delete suggestion.proposed_changes[key];
      }
    }
  }

  return {
    reasoning: suggestion.reasoning || 'Here are the proposed changes based on your input.',
    proposed_changes: suggestion.proposed_changes || {},
    downstream_effects: suggestion.downstream_effects || [],
  };
}

// GET /api/goals/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const supabase = await createClient();
    const { id: goalId } = await params;

    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select(PILLAR_SELECT)
      .eq('id', goalId)
      .eq('user_id', user.id)
      .single();

    if (goalError || !goal) {
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(attachPillarColor(goal));
  } catch (error) {
    console.error('GET /api/goals/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/goals/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const supabase = await createClient();
    const { id: goalId } = await params;
    const body = await req.json();

    // Handle NL prompt — use AI to generate suggestion from user's input
    if (body.prompt) {
      const { data: goal, error: goalError } = await supabase
        .from('goals')
        .select('*')
        .eq('id', goalId)
        .eq('user_id', user.id)
        .single();

      if (goalError || !goal) {
        return NextResponse.json(
          { error: 'Goal not found' },
          { status: 404 }
        );
      }

      try {
        const suggestion = await generateGoalSuggestion(goal, body.prompt);
        return NextResponse.json({ suggestion });
      } catch (err) {
        logError('goals.prompt', err);
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Failed to generate suggestion' },
          { status: 500 }
        );
      }
    }

    // Get current goal state for history
    const { data: currentGoal, error: fetchError } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !currentGoal) {
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    // Determine what changed
    const changedFields: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const [key, newValue] of Object.entries(body)) {
      if (currentGoal[key] !== newValue) {
        changedFields[key] = newValue;
        oldValues[key] = currentGoal[key];
        newValues[key] = newValue;
      }
    }

    // If nothing actually changed, return the current goal as-is
    if (Object.keys(changedFields).length === 0) {
      const { data: unchanged } = await supabase
        .from('goals')
        .select(PILLAR_SELECT)
        .eq('id', goalId)
        .eq('user_id', user.id)
        .single();
      return NextResponse.json(attachPillarColor(unchanged));
    }

    // Update goal
    const { data: updated, error: updateError } = await supabase
      .from('goals')
      .update(changedFields)
      .eq('id', goalId)
      .eq('user_id', user.id)
      .select(PILLAR_SELECT)
      .single();

    if (updateError) {
      console.error('PATCH update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update goal' },
        { status: 500 }
      );
    }

    // Record change in history if anything changed
    if (Object.keys(changedFields).length > 0) {
      await supabase.from('goal_history').insert({
        goal_id: goalId,
        user_id: user.id,
        field_changed: Object.keys(changedFields).join(', '),
        old_value: JSON.stringify(oldValues),
        new_value: JSON.stringify(newValues),
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(attachPillarColor(updated));
  } catch (error) {
    console.error('PATCH /api/goals/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/goals/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const supabase = await createClient();
    const { id: goalId } = await params;

    const { data: goal, error: fetchError } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !goal) {
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabase
      .from('goals')
      .update({ status: 'abandoned' })
      .eq('id', goalId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('DELETE soft delete error:', updateError);
      return NextResponse.json(
        { error: 'Failed to delete goal' },
        { status: 500 }
      );
    }

    // Record deletion in history
    await supabase.from('goal_history').insert({
      goal_id: goalId,
      user_id: user.id,
      field_changed: 'status',
      old_value: goal.status,
      new_value: 'abandoned',
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/goals/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
