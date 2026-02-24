-- Create players table
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  size REAL NOT NULL DEFAULT 10,
  color TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create pixels (food) table
CREATE TABLE IF NOT EXISTS pixels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  x REAL NOT NULL,
  y REAL NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE pixels ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access (since players authenticate with Firebase, we rely on Supabase anonymous key for realtime syncing, 
-- or we can use custom JWT. For simplicity and as required by the 'anon_key' usage, we allow public read/write, 
-- but in production we'd tie this to Firebase Auth using Supabase custom JWTs).
-- Assuming public access for the game's realtime sync for this evaluate.
CREATE POLICY "Enable read access for all users" ON players FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON players FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON players FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON pixels FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON pixels FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON pixels FOR DELETE USING (true);

-- Enable Realtime for both tables
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table pixels;
