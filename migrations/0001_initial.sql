CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('user', 'official')),
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'removed'))
);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirm', 'not_confirm', 'helpful')),
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, client_id, kind)
);

CREATE INDEX IF NOT EXISTS reactions_post_id_idx ON reactions(post_id);
CREATE INDEX IF NOT EXISTS posts_activity_idx ON posts(status, last_activity_at DESC);
