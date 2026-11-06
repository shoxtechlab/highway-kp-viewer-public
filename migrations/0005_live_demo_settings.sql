CREATE TABLE IF NOT EXISTS live_demo_settings (
  route_id TEXT PRIMARY KEY CHECK (route_id IN ('e28', 'e30', 'e76')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  start_kp REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  speed_kmh REAL NOT NULL DEFAULT 80,
  started_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO live_demo_settings VALUES ('e28', 0, 44.4, 'down', 80, 0);
INSERT OR IGNORE INTO live_demo_settings VALUES ('e30', 0, 0, 'down', 80, 0);
INSERT OR IGNORE INTO live_demo_settings VALUES ('e76', 0, 0, 'down', 80, 0);
