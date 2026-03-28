export function validateInternalRequest(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return token === (process.env.RUHROHHALP_SECRET || process.env.CRON_SECRET);
}
