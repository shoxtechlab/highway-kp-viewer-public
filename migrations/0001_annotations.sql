CREATE TABLE IF NOT EXISTS annotations (
  id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (route_id, id)
);

CREATE INDEX IF NOT EXISTS annotations_route_id
  ON annotations (route_id, updated_at);
