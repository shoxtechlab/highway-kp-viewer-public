-- KP検索の日次枠から独立した位置共有APIの利用枠（閲覧・状態確認・投稿）。
CREATE TABLE IF NOT EXISTS live_api_daily_usage (
    usage_date TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
