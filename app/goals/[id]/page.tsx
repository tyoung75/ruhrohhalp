'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client-api';
import { C } from '@/lib/ui';
import { Spinner } from '@/components/primitives';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  title: string;
  description: string | null;
  pillar_id: string;
  pillar?: { id: string; name: string; color: string };
  progress_current: string | null;
  progress_target: string | null;
  progress_metric: string | null;
  status: string;
  priority: string;
  target_date: string | null;
  methods: string[] | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: string;
  title: string;
  state: string;
  priority_num: number;
  due_date: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TasksResponse {
  tasks: Task[];
  total: number;
}

interface CheckIn {
  id: string;
  goal_id: string;
  value: string;
  note: string | null;
  created_at: string;
}

interface Signal {
  id: string;
  goal_id: string;
  signal_type: string;
  content: string;
  sentiment: string | null;
  impact_score: number;
  source_ref: string | null;
  created_at: string;
}

interface HistoryEntry {
  id: string;
  goal_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  change_reason: string | null;
  created_at: string;
}

interface Suggestion {
  reasoning: string;
  proposed_changes: Record<string, unknown>;
  downstream_effects: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: C.gpt },
  paused: { label: 'Paused', color: C.task },
  completed: { label: 'Completed', color: C.gem },
  archived: { label: 'Archived', color: C.textDim },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: C.reminder },
  high: { label: 'High', color: C.task },
  medium: { label: 'Medium', color: C.gem },
  low: { label: 'Low', color: C.textDim },
};

const SIGNAL_ICONS: Record<string, string> = {
  email: '✉',
  calendar: '📅',
  social_post: '📱',
  purchase: '💳',
  workout: '🏃',
  task_completed: '✓',
  manual: '✏',
  webhook: '⚡',
};

const TASK_STATE_COLORS: Record<string, string> = {
  started: C.gpt,
  unstarted: C.gem,
  backlog: C.textDim,
  in_review: C.task,
  done: C.gpt,
  cancelled: C.textFaint,
};

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

function Section({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 20,
        marginBottom: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: C.text, margin: '0 0 16px 0', fontSize: 15, fontWeight: 600, fontFamily: C.sans }}>
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function GoalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const goalId = params.id as string;

  const [goal, setGoal] = useState<Goal | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing states
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  // NL prompt
  const [prompt, setPrompt] = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [applyingChanges, setApplyingChanges] = useState(false);

  // History expand
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // ---- Data fetching ----
  const fetchGoal = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api<Goal>(`/api/goals/${goalId}`, { method: 'GET' });
      setGoal(data);
      setTitleValue(data.title);
      setDescValue(data.description || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch goal');
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    if (!goalId) return;
    fetchGoal();

    // Parallel fetches for secondary data
    api<TasksResponse>(`/api/tasks?goal_id=${goalId}`)
      .then((res) => setTasks(res.tasks ?? []))
      .catch(() => {});

    api<CheckIn[]>(`/api/goals/${goalId}/checkins`)
      .then((data) => setCheckins(data))
      .catch(() => {});

    api<Signal[]>(`/api/goals/${goalId}/signals`)
      .then((data) => setSignals(data))
      .catch(() => {});

    api<HistoryEntry[]>(`/api/goals/${goalId}/history`)
      .then((data) => setHistory(data))
      .catch(() => {});
  }, [goalId, fetchGoal]);

  // ---- Handlers ----
  const handleTitleEdit = async () => {
    if (!titleValue.trim() || titleValue === goal?.title) {
      setEditingTitle(false);
      return;
    }
    try {
      setSavingTitle(true);
      const updated = await api<Goal>(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: titleValue }),
      });
      setGoal(updated);
      setEditingTitle(false);
    } catch {
      setTitleValue(goal?.title || '');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleDescEdit = async () => {
    if (descValue === (goal?.description || '')) {
      setEditingDesc(false);
      return;
    }
    try {
      setSavingDesc(true);
      const updated = await api<Goal>(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: descValue }),
      });
      setGoal(updated);
      setEditingDesc(false);
    } catch {
      setDescValue(goal?.description || '');
    } finally {
      setSavingDesc(false);
    }
  };

  const handlePromptSubmit = async () => {
    if (!prompt.trim()) return;
    try {
      setLoadingPrompt(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await api<any>(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ prompt }),
      });
      if (response.suggestion) setSuggestion(response.suggestion);
    } catch {
      // noop
    } finally {
      setLoadingPrompt(false);
    }
  };

  const handleApplyChanges = async () => {
    if (!suggestion) return;
    try {
      setApplyingChanges(true);
      const updated = await api<Goal>(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify(suggestion.proposed_changes),
      });
      setGoal(updated);
      setSuggestion(null);
      setPrompt('');
    } catch {
      // noop
    } finally {
      setApplyingChanges(false);
    }
  };

  // ---- Loading / Error states ----
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spinner />
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.push('/')}
          style={{ background: 'none', border: 'none', color: C.cl, cursor: 'pointer', fontFamily: C.sans, fontSize: 13, padding: 0, marginBottom: 16 }}
        >
          &larr; Command Center
        </button>
        <div style={{ color: C.reminder, fontSize: 14 }}>{error || 'Goal not found'}</div>
      </div>
    );
  }

  const pillarColor = goal.pillar?.color || C.cl;
  const progressCurrent = parseFloat(goal.progress_current ?? '0');
  const progressTarget = parseFloat(goal.progress_target ?? '100');
  const progressPercent = progressTarget > 0 ? Math.min(100, (progressCurrent / progressTarget) * 100) : 0;
  const statusCfg = STATUS_CONFIG[goal.status] || STATUS_CONFIG.active;
  const priorityCfg = PRIORITY_CONFIG[goal.priority] || PRIORITY_CONFIG.medium;
  const activeTasks = tasks.filter((t) => ['started', 'unstarted', 'in_review'].includes(t.state));
  const completedTasks = tasks.filter((t) => t.state === 'done');
  const visibleHistory = historyExpanded ? history : history.slice(0, 5);

  return (
    <div style={{ padding: '24px', maxWidth: 840, margin: '0 auto', fontFamily: C.sans }}>
      {/* ---- Breadcrumb ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Link
          href="/"
          style={{
            color: C.textDim,
            textDecoration: 'none',
            fontSize: 13,
            fontFamily: C.sans,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.cl)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.textDim)}
        >
          Command Center
        </Link>
        <span style={{ color: C.textFaint, fontSize: 11 }}>/</span>
        {goal.pillar && (
          <>
            <span style={{ color: pillarColor, fontSize: 13, fontFamily: C.sans }}>
              {goal.pillar.name}
            </span>
            <span style={{ color: C.textFaint, fontSize: 11 }}>/</span>
          </>
        )}
        <span style={{ color: C.text, fontSize: 13, fontFamily: C.sans }}>
          Goal
        </span>
      </div>

      {/* ---- Header: Title + Meta ---- */}
      <div style={{ marginBottom: 28 }}>
        {/* Editable title */}
        {editingTitle ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTitleEdit(); if (e.key === 'Escape') { setTitleValue(goal.title); setEditingTitle(false); } }}
              onBlur={handleTitleEdit}
              autoFocus
              style={{
                flex: 1, fontSize: 26, fontWeight: 'bold', fontFamily: C.serif, fontStyle: 'italic',
                backgroundColor: C.surface, border: `1px solid ${pillarColor}40`, color: C.cream,
                padding: '8px 12px', borderRadius: 6, outline: 'none',
              }}
            />
            {savingTitle && <Spinner />}
          </div>
        ) : (
          <h1
            onClick={() => setEditingTitle(true)}
            style={{
              fontSize: 26, fontWeight: 'bold', color: C.cream, margin: '0 0 12px 0',
              cursor: 'pointer', fontFamily: C.serif, fontStyle: 'italic',
              transition: 'color 0.15s', lineHeight: 1.3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = pillarColor)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.cream)}
          >
            {goal.title}
          </h1>
        )}

        {/* Meta row: pillar badge, status, priority, target date */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {goal.pillar && (
            <span style={{
              display: 'inline-block', padding: '3px 10px', backgroundColor: `${pillarColor}20`,
              color: pillarColor, borderRadius: 4, fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', fontFamily: C.mono, letterSpacing: 0.5,
              border: `1px solid ${pillarColor}30`,
            }}>
              {goal.pillar.name}
            </span>
          )}
          <span style={{
            padding: '3px 10px', backgroundColor: `${statusCfg.color}18`,
            color: statusCfg.color, borderRadius: 4, fontSize: 11, fontWeight: 600,
            fontFamily: C.mono, border: `1px solid ${statusCfg.color}25`,
          }}>
            {statusCfg.label}
          </span>
          <span style={{
            padding: '3px 10px', backgroundColor: `${priorityCfg.color}18`,
            color: priorityCfg.color, borderRadius: 4, fontSize: 11, fontWeight: 600,
            fontFamily: C.mono, border: `1px solid ${priorityCfg.color}25`,
          }}>
            {priorityCfg.label}
          </span>
          {goal.target_date && (
            <span style={{ color: C.textDim, fontSize: 12, fontFamily: C.mono }}>
              Target: {formatDate(goal.target_date)}
            </span>
          )}
          <span style={{ color: C.textFaint, fontSize: 11, fontFamily: C.mono, marginLeft: 'auto' }}>
            Updated {relativeTime(goal.updated_at)}
          </span>
        </div>
      </div>

      {/* ---- Description (editable) ---- */}
      <Section>
        <SectionTitle>Description</SectionTitle>
        {editingDesc ? (
          <div style={{ position: 'relative' }}>
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={handleDescEdit}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDescValue(goal.description || ''); setEditingDesc(false); } }}
              autoFocus
              rows={4}
              style={{
                width: '100%', backgroundColor: C.surface, border: `1px solid ${C.border}`,
                color: C.text, padding: '10px 12px', borderRadius: 6, fontFamily: C.sans,
                fontSize: 14, lineHeight: 1.6, resize: 'vertical', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {savingDesc && <Spinner />}
          </div>
        ) : (
          <div
            onClick={() => setEditingDesc(true)}
            style={{
              color: goal.description ? C.text : C.textFaint,
              fontSize: 14, lineHeight: 1.6, cursor: 'pointer',
              padding: '8px 0', transition: 'color 0.15s', whiteSpace: 'pre-wrap',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.cream)}
            onMouseLeave={(e) => (e.currentTarget.style.color = goal.description ? C.text : C.textFaint)}
          >
            {goal.description || 'Click to add a description...'}
          </div>
        )}
      </Section>

      {/* ---- Progress Tracking ---- */}
      <Section>
        <SectionTitle>Progress</SectionTitle>
        <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Current
            </div>
            <div style={{ color: C.cream, fontSize: 22, fontWeight: 'bold', fontFamily: C.mono }}>
              {goal.progress_current ?? '--'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', color: C.textFaint, fontSize: 18 }}>
            &rarr;
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Target
            </div>
            <div style={{ color: C.cream, fontSize: 22, fontWeight: 'bold', fontFamily: C.mono }}>
              {goal.progress_target ?? '--'}
            </div>
          </div>
          {goal.progress_metric && (
            <div style={{ flex: 1 }}>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Metric
              </div>
              <div style={{ color: C.text, fontSize: 14, fontFamily: C.sans }}>
                {goal.progress_metric}
              </div>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ backgroundColor: `${pillarColor}15`, borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{
            backgroundColor: pillarColor, height: '100%',
            width: `${Math.min(progressPercent, 100)}%`,
            transition: 'width 0.4s ease',
            boxShadow: progressPercent > 50 ? `0 0 ${Math.floor(progressPercent / 20)}px ${pillarColor}60` : 'none',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: pillarColor, fontSize: 12, fontWeight: 600, fontFamily: C.mono }}>
            {progressPercent.toFixed(0)}% complete
          </span>
          {goal.target_date && (
            <span style={{ color: C.textFaint, fontSize: 11, fontFamily: C.mono }}>
              Due {formatDate(goal.target_date)}
            </span>
          )}
        </div>

        {/* Check-in data points */}
        {checkins.length > 0 && (
          <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Recent Check-ins
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {checkins.slice(0, 8).map((ci) => (
                <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.textFaint, fontSize: 11, fontFamily: C.mono, width: 70, flexShrink: 0 }}>
                    {relativeTime(ci.created_at)}
                  </span>
                  <span style={{ color: pillarColor, fontSize: 13, fontWeight: 600, fontFamily: C.mono }}>
                    {ci.value}
                  </span>
                  {ci.note && (
                    <span style={{ color: C.textDim, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ci.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ---- Methods & Tags ---- */}
      {((goal.methods && goal.methods.length > 0) || (goal.tags && goal.tags.length > 0)) && (
        <Section>
          {goal.methods && goal.methods.length > 0 && (
            <div style={{ marginBottom: goal.tags && goal.tags.length > 0 ? 16 : 0 }}>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Methods
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {goal.methods.map((method, i) => (
                  <span key={i} style={{
                    fontFamily: C.mono, fontSize: 11, color: C.text,
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: '4px 10px',
                  }}>
                    {method}
                  </span>
                ))}
              </div>
            </div>
          )}
          {goal.tags && goal.tags.length > 0 && (
            <div>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Tags
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {goal.tags.map((tag, i) => (
                  <span key={i} style={{
                    fontFamily: C.mono, fontSize: 10, color: pillarColor,
                    background: `${pillarColor}12`, border: `1px solid ${pillarColor}25`,
                    borderRadius: 4, padding: '3px 8px',
                  }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ---- NL Prompt Widget ---- */}
      <Section>
        <SectionTitle>Ask about this goal</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !loadingPrompt) handlePromptSubmit(); }}
            placeholder="e.g. 'Adjust my target pace based on recent training...'"
            style={{
              flex: 1, padding: '10px 12px', backgroundColor: C.surface,
              border: `1px solid ${C.border}`, color: C.text, borderRadius: 6,
              fontFamily: C.sans, fontSize: 13, outline: 'none',
            }}
          />
          <button
            onClick={handlePromptSubmit}
            disabled={loadingPrompt}
            style={{
              padding: '10px 16px', backgroundColor: pillarColor, color: C.cream,
              border: 'none', borderRadius: 6, fontWeight: 600,
              cursor: loadingPrompt ? 'not-allowed' : 'pointer',
              opacity: loadingPrompt ? 0.6 : 1, fontFamily: C.sans, fontSize: 13,
            }}
          >
            {loadingPrompt ? <Spinner color={C.cream} size={12} /> : 'Ask'}
          </button>
        </div>

        {suggestion && (
          <div style={{
            backgroundColor: C.surface, border: `1px solid ${pillarColor}40`,
            borderRadius: 6, padding: 16, marginTop: 14,
          }}>
            <div style={{ color: pillarColor, fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              AI Suggestion
            </div>
            <p style={{ color: C.text, fontSize: 13, lineHeight: 1.6, margin: '0 0 12px 0' }}>
              {suggestion.reasoning}
            </p>

            {Object.keys(suggestion.proposed_changes).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6 }}>Proposed Changes</div>
                {Object.entries(suggestion.proposed_changes).map(([key, value]) => (
                  <div key={key} style={{ color: C.cream, fontSize: 12, marginBottom: 3, fontFamily: C.mono }}>
                    <span style={{ color: C.textDim }}>{key}:</span> {String(value)}
                  </div>
                ))}
              </div>
            )}

            {suggestion.downstream_effects.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6 }}>Effects</div>
                {suggestion.downstream_effects.map((effect, idx) => (
                  <div key={idx} style={{ color: C.textFaint, fontSize: 12, marginBottom: 3 }}>
                    &bull; {effect}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleApplyChanges}
                disabled={applyingChanges}
                style={{
                  flex: 1, padding: '8px 12px', backgroundColor: C.gpt, color: C.cream,
                  border: 'none', borderRadius: 4, fontWeight: 600,
                  cursor: applyingChanges ? 'not-allowed' : 'pointer',
                  opacity: applyingChanges ? 0.6 : 1, fontFamily: C.sans, fontSize: 12,
                }}
              >
                {applyingChanges ? 'Applying...' : 'Apply Changes'}
              </button>
              <button
                onClick={() => setSuggestion(null)}
                style={{
                  flex: 1, padding: '8px 12px', backgroundColor: C.surface, color: C.text,
                  border: `1px solid ${C.border}`, borderRadius: 4, fontWeight: 600,
                  cursor: 'pointer', fontFamily: C.sans, fontSize: 12,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* ---- Related Tasks ---- */}
      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionTitle>Related Tasks</SectionTitle>
          {tasks.length > 0 && (
            <span style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono }}>
              {activeTasks.length} active &middot; {completedTasks.length} done
            </span>
          )}
        </div>

        {tasks.length === 0 ? (
          <p style={{ color: C.textFaint, fontSize: 13, margin: 0 }}>
            No tasks linked to this goal yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.map((task) => {
              const stateColor = TASK_STATE_COLORS[task.state] || C.textDim;
              return (
                <div
                  key={task.id}
                  onClick={() => router.push(`/tasks`)}
                  style={{
                    padding: '10px 12px', backgroundColor: C.surface,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${pillarColor}40`)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      backgroundColor: stateColor, flexShrink: 0,
                    }} />
                    <span style={{
                      color: C.text, fontSize: 13, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {task.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {task.due_date && (
                      <span style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono }}>
                        {formatDate(task.due_date)}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10, padding: '2px 6px', backgroundColor: `${stateColor}18`,
                      color: stateColor, borderRadius: 3, textTransform: 'uppercase',
                      fontWeight: 600, fontFamily: C.mono, border: `1px solid ${stateColor}25`,
                    }}>
                      {task.state}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ---- Signals & Linked Content ---- */}
      {signals.length > 0 && (
        <Section>
          <SectionTitle>Signals &amp; Linked Content</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {signals.map((signal) => {
              const icon = SIGNAL_ICONS[signal.signal_type] || '&bull;';
              const sentimentColor = signal.sentiment === 'positive' ? C.gpt
                : signal.sentiment === 'negative' ? C.reminder : C.textDim;
              return (
                <div
                  key={signal.id}
                  style={{
                    padding: '10px 12px', backgroundColor: C.surface,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
                      {signal.content}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontFamily: C.mono, color: C.textFaint,
                        textTransform: 'uppercase',
                      }}>
                        {signal.signal_type.replace('_', ' ')}
                      </span>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: sentimentColor }} />
                      <span style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono }}>
                        {relativeTime(signal.created_at)}
                      </span>
                      {signal.source_ref && (
                        <span style={{ color: C.textFaint, fontSize: 10, fontFamily: C.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ref: {signal.source_ref}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    width: 28, height: 28, borderRadius: 4,
                    backgroundColor: `${pillarColor}${Math.round(signal.impact_score * 40).toString(16).padStart(2, '0')}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontFamily: C.mono, color: pillarColor, fontWeight: 600, flexShrink: 0,
                  }}>
                    {(signal.impact_score * 10).toFixed(0)}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ---- Timeline / History ---- */}
      <Section style={{ marginBottom: 40 }}>
        <SectionTitle>Timeline</SectionTitle>
        {history.length === 0 ? (
          <p style={{ color: C.textFaint, fontSize: 13, margin: 0 }}>
            No changes recorded yet.
          </p>
        ) : (
          <>
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              {/* Vertical timeline line */}
              <div style={{
                position: 'absolute', left: 5, top: 4, bottom: 4,
                width: 2, backgroundColor: C.border, borderRadius: 1,
              }} />

              {visibleHistory.map((entry, idx) => (
                <div key={entry.id} style={{ position: 'relative', marginBottom: idx < visibleHistory.length - 1 ? 16 : 0 }}>
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: -18, top: 4,
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: pillarColor, border: `2px solid ${C.card}`,
                  }} />

                  <div style={{ paddingLeft: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
                        {entry.field_changed || 'Updated'}
                      </span>
                      <span style={{ color: C.textFaint, fontSize: 11, fontFamily: C.mono }}>
                        {relativeTime(entry.created_at)}
                      </span>
                    </div>

                    {(entry.old_value || entry.new_value) && (
                      <div style={{ fontSize: 12, color: C.textDim }}>
                        {entry.old_value && (
                          <span style={{ color: C.reminder, fontFamily: C.mono, fontSize: 11 }}>
                            {entry.old_value}
                          </span>
                        )}
                        {entry.old_value && entry.new_value && (
                          <span style={{ color: C.textFaint, margin: '0 6px' }}>&rarr;</span>
                        )}
                        {entry.new_value && (
                          <span style={{ color: C.gpt, fontFamily: C.mono, fontSize: 11 }}>
                            {entry.new_value}
                          </span>
                        )}
                      </div>
                    )}

                    {entry.change_reason && (
                      <div style={{ color: C.textFaint, fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>
                        {entry.change_reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {history.length > 5 && (
              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                style={{
                  marginTop: 12, background: 'none', border: `1px solid ${C.border}`,
                  color: C.textDim, borderRadius: 4, padding: '6px 12px',
                  cursor: 'pointer', fontFamily: C.mono, fontSize: 11, width: '100%',
                }}
              >
                {historyExpanded ? 'Show less' : `Show all ${history.length} entries`}
              </button>
            )}
          </>
        )}

        {/* Goal created timestamp */}
        <div style={{
          marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between',
          color: C.textFaint, fontSize: 11, fontFamily: C.mono,
        }}>
          <span>Created {formatDate(goal.created_at)}</span>
          <span>Last updated {formatDate(goal.updated_at)}</span>
        </div>
      </Section>
    </div>
  );
}
