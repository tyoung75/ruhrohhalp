'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client-api';
import { C } from '@/lib/ui';
import { Spinner } from '@/components/primitives';

interface Goal {
  id: string;
  title: string;
  pillar_id: string;
  pillar?: { id: string; name: string; color: string };
  progress_current: number;
  progress_target: number;
  progress_unit: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface HistoryEntry {
  id: string;
  goal_id: string;
  change_type: string;
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  created_at: string;
  user_id: string;
}

interface Suggestion {
  reasoning: string;
  proposed_changes: Record<string, unknown>;
  downstream_effects: string[];
}

export default function GoalDetailPage() {
  const params = useParams();
  const goalId = params.id as string;

  const [goal, setGoal] = useState<Goal | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  // NL prompt
  const [prompt, setPrompt] = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [applyingChanges, setApplyingChanges] = useState(false);

  // Fetch goal data
  useEffect(() => {
    const fetchGoal = async () => {
      try {
        setLoading(true);
        const data = await api(`/api/goals/${goalId}`, { method: 'GET' });
        setGoal(data);
        setTitleValue(data.title);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch goal');
      } finally {
        setLoading(false);
      }
    };

    if (goalId) {
      fetchGoal();
    }
  }, [goalId]);

  // Fetch related tasks
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await api(`/api/tasks?goal_id=${goalId}`, { method: 'GET' });
        setTasks(data);
      } catch (err) {
        console.error('Failed to fetch tasks:', err);
      }
    };

    if (goalId) {
      fetchTasks();
    }
  }, [goalId]);

  // Fetch goal history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const data = await api(`/api/goals/${goalId}/history`, { method: 'GET' });
        setHistory(data);
      } catch (err) {
        console.error('Failed to fetch history:', err);
      }
    };

    if (goalId) {
      fetchHistory();
    }
  }, [goalId]);

  const handleTitleEdit = async () => {
    if (!titleValue.trim() || titleValue === goal?.title) {
      setEditingTitle(false);
      return;
    }

    try {
      setSavingTitle(true);
      const updated = await api(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: { title: titleValue },
      });
      setGoal(updated);
      setEditingTitle(false);
    } catch (err) {
      console.error('Failed to update title:', err);
      setTitleValue(goal?.title || '');
    } finally {
      setSavingTitle(false);
    }
  };

  const handlePromptSubmit = async () => {
    if (!prompt.trim()) return;

    try {
      setLoadingPrompt(true);
      const response = await api(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: { prompt: prompt },
      });

      if (response.suggestion) {
        setSuggestion(response.suggestion);
      }
    } catch (err) {
      console.error('Failed to submit prompt:', err);
    } finally {
      setLoadingPrompt(false);
    }
  };

  const handleApplyChanges = async () => {
    if (!suggestion) return;

    try {
      setApplyingChanges(true);
      const updated = await api(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: suggestion.proposed_changes,
      });
      setGoal(updated);
      setSuggestion(null);
      setPrompt('');
    } catch (err) {
      console.error('Failed to apply changes:', err);
    } finally {
      setApplyingChanges(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spinner />
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div style={{ color: C.reminder, padding: '20px' }}>
        {error || 'Goal not found'}
      </div>
    );
  }

  const progressPercent = goal.progress_target > 0
    ? (goal.progress_current / goal.progress_target) * 100
    : 0;

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Header with Title */}
      <div style={{ marginBottom: '32px' }}>
        {editingTitle ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleEdit();
              }}
              onBlur={handleTitleEdit}
              autoFocus
              style={{
                flex: 1,
                fontSize: '28px',
                fontWeight: 'bold',
                backgroundColor: C.surface,
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: '8px 12px',
                borderRadius: '6px',
                fontFamily: C.sans,
              }}
            />
            {savingTitle && <Spinner />}
          </div>
        ) : (
          <h1
            onClick={() => setEditingTitle(true)}
            style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: C.text,
              margin: 0,
              cursor: 'pointer',
              padding: '8px 0',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.cl)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.text)}
          >
            {goal.title}
          </h1>
        )}

        {/* Pillar Badge */}
        {goal.pillar && (
          <div style={{ marginTop: '12px' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                backgroundColor: goal.pillar.color,
                color: C.cream,
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontFamily: C.sans,
              }}
            >
              {goal.pillar.name}
            </span>
          </div>
        )}
      </div>

      {/* Progress Section */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <h2 style={{ color: C.text, margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Progress
        </h2>

        {/* Current → Target */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: C.textDim, fontSize: '12px', marginBottom: '4px' }}>
            Current Value
          </div>
          <div style={{ color: C.cream, fontSize: '20px', fontWeight: 'bold' }}>
            {goal.progress_current} {goal.progress_unit}
          </div>
          <div style={{ color: C.textDim, fontSize: '12px', marginTop: '8px', marginBottom: '4px' }}>
            Target Value
          </div>
          <div style={{ color: C.cream, fontSize: '20px', fontWeight: 'bold' }}>
            {goal.progress_target} {goal.progress_unit}
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{
          backgroundColor: C.surface,
          borderRadius: '4px',
          height: '8px',
          overflow: 'hidden',
          marginBottom: '16px',
        }}>
          <div
            style={{
              backgroundColor: C.cl,
              height: '100%',
              width: `${Math.min(progressPercent, 100)}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ color: C.textFaint, fontSize: '12px' }}>
          {progressPercent.toFixed(0)}% complete
        </div>
      </div>

      {/* NL Prompt Widget */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loadingPrompt) handlePromptSubmit();
            }}
            placeholder="Ask anything about this goal..."
            style={{
              flex: 1,
              padding: '10px 12px',
              backgroundColor: C.surface,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: '6px',
              fontFamily: C.sans,
              fontSize: '14px',
            }}
          />
          <button
            onClick={handlePromptSubmit}
            disabled={loadingPrompt}
            style={{
              padding: '10px 16px',
              backgroundColor: C.cl,
              color: C.cream,
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: loadingPrompt ? 'not-allowed' : 'pointer',
              opacity: loadingPrompt ? 0.6 : 1,
              fontFamily: C.sans,
              fontSize: '14px',
            }}
          >
            {loadingPrompt ? <Spinner /> : 'Ask'}
          </button>
        </div>

        {/* Suggestion Card */}
        {suggestion && (
          <div style={{
            backgroundColor: C.surface,
            border: `1px solid ${C.cl}`,
            borderRadius: '6px',
            padding: '16px',
            marginTop: '16px',
          }}>
            <div style={{ color: C.textDim, fontSize: '12px', marginBottom: '8px' }}>
              AI Suggestion
            </div>
            <p style={{ color: C.text, fontSize: '14px', lineHeight: '1.5', margin: '0 0 12px 0' }}>
              {suggestion.reasoning}
            </p>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: C.textDim, fontSize: '12px', marginBottom: '8px' }}>
                Proposed Changes
              </div>
              {Object.entries(suggestion.proposed_changes).map(([key, value]) => (
                <div key={key} style={{ color: C.cream, fontSize: '13px', marginBottom: '4px' }}>
                  <strong>{key}:</strong> {String(value)}
                </div>
              ))}
            </div>

            {suggestion.downstream_effects.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ color: C.textDim, fontSize: '12px', marginBottom: '8px' }}>
                  Downstream Effects
                </div>
                {suggestion.downstream_effects.map((effect, idx) => (
                  <div key={idx} style={{ color: C.textFaint, fontSize: '13px', marginBottom: '4px' }}>
                    • {effect}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleApplyChanges}
                disabled={applyingChanges}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: C.gpt,
                  color: C.cream,
                  border: 'none',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: applyingChanges ? 'not-allowed' : 'pointer',
                  opacity: applyingChanges ? 0.6 : 1,
                  fontFamily: C.sans,
                  fontSize: '13px',
                }}
              >
                {applyingChanges ? 'Applying...' : 'Apply Changes'}
              </button>
              <button
                onClick={() => setSuggestion(null)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: C.surface,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: C.sans,
                  fontSize: '13px',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Related Tasks */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <h2 style={{ color: C.text, margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Related Tasks
        </h2>
        {tasks.length === 0 ? (
          <p style={{ color: C.textFaint, fontSize: '14px', margin: 0 }}>
            No tasks yet
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: '10px 12px',
                  backgroundColor: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ color: C.text, fontSize: '14px' }}>
                  {task.title}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    backgroundColor: C.task,
                    color: C.cream,
                    borderRadius: '3px',
                    textTransform: 'uppercase',
                    fontWeight: 'bold',
                  }}
                >
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Goal History */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        padding: '20px',
      }}>
        <h2 style={{ color: C.text, margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Goal History
        </h2>
        {history.length === 0 ? (
          <p style={{ color: C.textFaint, fontSize: '14px', margin: 0 }}>
            No changes recorded yet
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {history.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: '12px',
                  backgroundColor: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: '4px',
                }}
              >
                <div style={{ color: C.textDim, fontSize: '11px', marginBottom: '4px' }}>
                  {new Date(entry.created_at).toLocaleDateString()} {new Date(entry.created_at).toLocaleTimeString()}
                </div>
                <div style={{ color: C.text, fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {entry.change_type}
                </div>
                <div style={{ color: C.textFaint, fontSize: '12px' }}>
                  {Object.entries(entry.old_value).map(([key, oldVal]) => {
                    const newVal = entry.new_value[key];
                    return (
                      <div key={key}>
                        {key}: <span style={{ color: C.reminder }}>{String(oldVal)}</span> →{' '}
                        <span style={{ color: C.gpt }}>{String(newVal)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
