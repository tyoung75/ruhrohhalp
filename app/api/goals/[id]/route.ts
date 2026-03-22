import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

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

    // Handle NL prompt — generate suggestion without applying
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

      const suggestion = {
        reasoning: `Based on your current progress of ${goal.progress_current} toward your target of ${goal.progress_target}, and considering the timeline of this goal, here are some adjustments that could help optimize your approach.`,
        proposed_changes: {
          progress_target: goal.progress_target,
          title: goal.title,
        },
        downstream_effects: [
          'Training plan pace targets will be recalculated',
          'Weekly progress targets will be adjusted',
        ],
      };

      return NextResponse.json({ suggestion });
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
