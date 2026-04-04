-- Habits tracking tables

CREATE TABLE IF NOT EXISTS habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  target_count int NOT NULL DEFAULT 1,
  icon text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  value numeric DEFAULT 1,
  note text,
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'strava', 'whoop', 'auto'))
);

CREATE INDEX idx_habits_user ON habits(user_id, active);
CREATE INDEX idx_habit_logs_habit ON habit_logs(habit_id, logged_at DESC);
CREATE INDEX idx_habit_logs_user ON habit_logs(user_id, logged_at DESC);

ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own habits" ON habits FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can manage own habit logs" ON habit_logs FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role habits" ON habits FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role habit_logs" ON habit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed default habits for Tyler
INSERT INTO habits (user_id, name, frequency, target_count, icon) VALUES
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Run', 'daily', 1, ''),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Strength Training', 'daily', 1, ''),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Hydration (LMNT)', 'daily', 1, ''),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Sleep 7+ hours', 'daily', 1, ''),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Content Published', 'daily', 1, ''),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'WHOOP Recovery Check', 'daily', 1, '');
