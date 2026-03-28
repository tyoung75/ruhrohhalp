/**
 * Priority scoring engine for tasks.
 * Formula: (goal_impact × w1) + (urgency × w2) + (energy_fit × w3) + (recency × w4)
 * Halved if task is blocked.
 */

type ScoringWeights = {
  goal_impact: number;
  urgency: number;
  energy_fit: number;
  recency: number;
};

const DEFAULT_WEIGHTS: ScoringWeights = {
  goal_impact: 0.4,
  urgency: 0.3,
  energy_fit: 0.2,
  recency: 0.1,
};

type TaskRow = {
  id: string;
  priority_num: number | null;
  due_date: string | null;
  goal_id: string | null;
  state: string | null;
  created_at: string;
  updated_at: string;
  ai_metadata?: Record<string, unknown>;
};

export function computeUrgency(task: TaskRow): number {
  // Priority-based urgency
  const priorityScore = task.priority_num
    ? Math.max(0, (5 - task.priority_num) / 4)
    : 0.25;

  // Due-date urgency
  if (!task.due_date) return priorityScore;

  const now = Date.now();
  const due = new Date(task.due_date).getTime();
  const daysUntilDue = (due - now) / (1000 * 60 * 60 * 24);

  if (daysUntilDue <= 0) return 1.0; // overdue
  if (daysUntilDue <= 1) return 0.95;
  if (daysUntilDue <= 3) return 0.8;
  if (daysUntilDue <= 7) return 0.6;

  return Math.max(priorityScore, 0.3);
}

export function computeEnergyFit(task: TaskRow): number {
  // Time-of-day energy heuristic
  const hour = new Date().getHours();
  const isHighEnergy = hour >= 6 && hour <= 11;
  const isMedEnergy = hour >= 14 && hour <= 17;

  const taskPriority = task.priority_num ?? 3;

  if (isHighEnergy && taskPriority <= 2) return 0.9;
  if (isMedEnergy && taskPriority === 3) return 0.7;
  if (!isHighEnergy && taskPriority >= 3) return 0.6;

  return 0.5;
}

export function computeGoalImpact(task: TaskRow): number {
  // Tasks linked to goals get a base 0.7, unlinked get 0.3
  return task.goal_id ? 0.7 : 0.3;
}

function computeRecency(task: TaskRow): number {
  const now = Date.now();
  const updated = new Date(task.updated_at).getTime();
  const daysSinceUpdate = (now - updated) / (1000 * 60 * 60 * 24);

  if (daysSinceUpdate <= 1) return 0.9;
  if (daysSinceUpdate <= 3) return 0.7;
  if (daysSinceUpdate <= 7) return 0.5;
  return 0.3;
}

export function computePriorityScore(
  task: TaskRow,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const goalImpact = computeGoalImpact(task);
  const urgency = computeUrgency(task);
  const energyFit = computeEnergyFit(task);
  const recency = computeRecency(task);

  let score =
    goalImpact * weights.goal_impact +
    urgency * weights.urgency +
    energyFit * weights.energy_fit +
    recency * weights.recency;

  // Halve score if blocked
  if (task.state === "blocked") {
    score *= 0.5;
  }

  return Math.round(score * 1000) / 1000;
}

export function parseWeights(raw: unknown): ScoringWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_WEIGHTS;
  const obj = raw as Record<string, unknown>;
  return {
    goal_impact: typeof obj.goal_impact === "number" ? obj.goal_impact : DEFAULT_WEIGHTS.goal_impact,
    urgency: typeof obj.urgency === "number" ? obj.urgency : DEFAULT_WEIGHTS.urgency,
    energy_fit: typeof obj.energy_fit === "number" ? obj.energy_fit : DEFAULT_WEIGHTS.energy_fit,
    recency: typeof obj.recency === "number" ? obj.recency : DEFAULT_WEIGHTS.recency,
  };
}
