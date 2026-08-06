-- 0001_init.sql — 参考初始 schema（PostgreSQL）
-- 说明：骨架阶段后端默认使用内存 store；本文件为接入数据库时的迁移起点。
-- 命名遵循 10.1 核心数据实体。

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    avatar_url    TEXT NOT NULL DEFAULT '',
    region        TEXT NOT NULL DEFAULT 'cn',
    language      TEXT NOT NULL DEFAULT 'zh-CN',
    level         INTEGER NOT NULL DEFAULT 1,
    rating_score  INTEGER NOT NULL DEFAULT 1000,
    rating_tier   TEXT NOT NULL DEFAULT 'unranked',
    penalty_type  TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 显示名唯一约束（AUTH-003：重复规则校验）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users (display_name);

CREATE TABLE IF NOT EXISTS matches (
    id           TEXT PRIMARY KEY,
    mode         TEXT NOT NULL,
    map_id       INTEGER NOT NULL,
    region       TEXT NOT NULL,
    server_id    TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending|live|finished|aborted
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
    match_id     TEXT NOT NULL REFERENCES matches(id),
    user_id      TEXT NOT NULL REFERENCES users(id),
    team         INTEGER NOT NULL,                  -- 1=attack 2=defend
    kills        INTEGER NOT NULL DEFAULT 0,
    assists      INTEGER NOT NULL DEFAULT 0,
    deaths       INTEGER NOT NULL DEFAULT 0,
    headshots    INTEGER NOT NULL DEFAULT 0,
    damage       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS ratings (
    user_id      TEXT NOT NULL REFERENCES users(id),
    mode         TEXT NOT NULL,
    season       TEXT NOT NULL,
    score        INTEGER NOT NULL,
    confidence   INTEGER NOT NULL DEFAULT 500,
    tier         TEXT NOT NULL DEFAULT 'unranked',
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason       TEXT NOT NULL DEFAULT '',          -- 段位变更原因（10.2）
    PRIMARY KEY (user_id, mode, season)
);

CREATE TABLE IF NOT EXISTS penalties (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    type         TEXT NOT NULL,                     -- warn|temporary_ban|permanent_ban
    reason       TEXT NOT NULL,
    evidence     JSONB NOT NULL DEFAULT '{}',
    started_at   TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ,
    review_state TEXT NOT NULL DEFAULT 'pending',   -- 申诉复核状态
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_results (
    match_id     TEXT PRIMARY KEY REFERENCES matches(id),
    idempotency_key TEXT NOT NULL UNIQUE,           -- 结算幂等键（10.2）
    outcome      INTEGER NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
