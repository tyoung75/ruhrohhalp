/**
 * Global background task runner.
 *
 * Allows API calls to survive client-side page navigations.
 * Tasks run as fire-and-forget promises tracked in module-level state.
 * UI listens via `bgTasks.subscribe()` for toast notifications.
 */

export interface BgTask {
  id: string;
  label: string;
  status: "running" | "success" | "error";
  message?: string;
  startedAt: number;
}

type Listener = (tasks: BgTask[]) => void;

let tasks: BgTask[] = [];
const listeners = new Set<Listener>();

function notify() {
  const snapshot = [...tasks];
  for (const fn of listeners) fn(snapshot);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run an async function in the background. The promise is tracked globally
 * and will complete even if the calling component unmounts.
 *
 * @param label  Human-readable label for the toast (e.g. "Scouting brands")
 * @param fn     Async function to execute. Receives no args, returns a message string on success.
 * @param opts   Optional callbacks for success/error (called only if component is still mounted).
 */
export function runBgTask(
  label: string,
  fn: () => Promise<string>,
  opts?: { onSuccess?: (msg: string) => void; onError?: (err: string) => void },
) {
  const id = generateId();
  const task: BgTask = { id, label, status: "running", startedAt: Date.now() };
  tasks = [...tasks, task];
  notify();

  fn().then(
    (msg) => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status: "success" as const, message: msg } : t));
      notify();
      opts?.onSuccess?.(msg);
      // Auto-remove after 6s
      setTimeout(() => {
        tasks = tasks.filter((t) => t.id !== id);
        notify();
      }, 6000);
    },
    (err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      tasks = tasks.map((t) => (t.id === id ? { ...t, status: "error" as const, message: errMsg } : t));
      notify();
      opts?.onError?.(errMsg);
      // Auto-remove after 8s
      setTimeout(() => {
        tasks = tasks.filter((t) => t.id !== id);
        notify();
      }, 8000);
    },
  );

  return id;
}

/** Subscribe to task state changes. Returns an unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  // Immediately fire with current state
  fn([...tasks]);
  return () => listeners.delete(fn);
}

/** Dismiss a task notification early. */
export function dismiss(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  notify();
}

/** Check if any task with the given label is currently running. */
export function isRunning(label: string): boolean {
  return tasks.some((t) => t.label === label && t.status === "running");
}
