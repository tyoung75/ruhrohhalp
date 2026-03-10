export function logInfo(event: string, data?: unknown): void {
  console.info(JSON.stringify({ level: "info", event, data, ts: new Date().toISOString() }));
}

export function logError(event: string, error: unknown, data?: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", event, message, data, ts: new Date().toISOString() }));
}
