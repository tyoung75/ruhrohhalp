import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

async function getSupabaseClient(_req: NextRequest) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}

// GET /api/goals/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getSupabaseClient(req);
    const goalId = params.id;

    // Get goal with related pillar
    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select(
        `
        *,
        pillar:pillar_id (
          id,
          name,
          color
        )
      `
      )
      .eq('id', goalId)
      .single();

    if (goalError || !goal) {
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(goal);
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
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getSupabaseClient(req);
    const goalId = params.id;
    const body = await req.json();

    // Handle NL prompt — generate suggestion without applying
    if (body.prompt) {
      const { data: goal, error: goalError } = await supabase
        .from('goals')
        .select('*')
        .eq('id', goalId)
        .single();

      if (goalError || !goal) {
        return NextResponse.json(
          { error: 'Goal not found' },
          { status: 404 }
        );
      }

      // Template suggestion based on goal data
      const suggestion = {
        reasoning: `Based on your current progress of ${goal.progress_current} ${goal.progress_unit} toward your target of ${goal.progress_target} ${goal.progress_unit}, and considering the timeline of this goal, here are some adjustments that could help optimize your approach.`,
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
      .select(
        `
        *,
        pillar:pillar_id (
          id,
          name,
          color
        )
      `
      )
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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase.from('goal_history').insert({
        goal_id: goalId,
        user_id: user?.id || 'unknown',
        change_type: 'updated',
        old_value: oldValues,
        new_value: newValues,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(updated);
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
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getSupabaseClient(req);
    const goalId = params.id;

    // Soft delete — set status to 'abandoned'
    const { data: goal, error: fetchError } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
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
      .eq('id', goalId);

    if (updateError) {
      console.error('DELETE soft delete error:', updateError);
      return NextResponse.json(
        { error: 'Failed to delete goal' },
        { status: 500 }
      );
    }

    // Record deletion in history
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from('goal_history').insert({
      goal_id: goalId,
      user_id: user?.id || 'unknown',
      change_type: 'abandoned',
      old_value: { status: goal.status },
      new_value: { status: 'abandoned' },
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
