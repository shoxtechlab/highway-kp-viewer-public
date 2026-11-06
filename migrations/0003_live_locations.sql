CREATE TABLE IF NOT EXISTS live_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  route_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  route_kp REAL NOT NULL,
  kp REAL NOT NULL,
  kp_system_id TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS live_locations_route_expiry ON live_locations(route_id, expires_at);
CREATE TABLE IF NOT EXISTS live_location_usage (
  day TEXT PRIMARY KEY,
  write_count INTEGER NOT NULL DEFAULT 0
);
