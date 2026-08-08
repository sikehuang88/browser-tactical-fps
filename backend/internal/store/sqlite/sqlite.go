// Package sqlite provides the persistent business store used by the local API.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fpsweb/game/backend/internal/store"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func New(path string) (*Store, error) {
	if path == "" {
		path = "data/fpsweb.db"
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create sqlite directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) init() error {
	_, err := s.db.Exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, region TEXT NOT NULL DEFAULT 'cn',
 language TEXT NOT NULL DEFAULT 'zh-CN', level INTEGER NOT NULL DEFAULT 1,
 rating_score INTEGER NOT NULL DEFAULT 1000, rating_tier TEXT NOT NULL DEFAULT 'unranked',
 experience INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 2450,
 kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0,
 wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
 matches INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL,
 penalty_type TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE TABLE IF NOT EXISTS user_tasks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT NOT NULL,
 label TEXT NOT NULL DEFAULT '',
 value INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL, reward INTEGER NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0, tracked INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, task_id)
);
CREATE TABLE IF NOT EXISTS user_checkins (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 last_date TEXT NOT NULL DEFAULT '', streak INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);`)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(`ALTER TABLE user_tasks ADD COLUMN label TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	return nil
}

func (s *Store) CreateUser(ctx context.Context, u *store.User) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users
	(id,display_name,region,language,level,rating_score,rating_tier,experience,credits,kills,deaths,wins,losses,matches,last_seen_at,penalty_type,created_at)
	VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, u.ID, u.DisplayName, u.Region, u.Language, u.Level, u.RatingScore, u.RatingTier, u.Experience, u.Credits, u.Kills, u.Deaths, u.Wins, u.Losses, u.Matches, stamp(u.LastSeenAt), u.PenaltyType, stamp(u.CreatedAt))
	return err
}

func (s *Store) GetUser(ctx context.Context, id string) (*store.User, error) {
	u := &store.User{}
	var lastSeen, created string
	err := s.db.QueryRowContext(ctx, `SELECT id,display_name,region,language,level,rating_score,rating_tier,experience,credits,kills,deaths,wins,losses,matches,last_seen_at,penalty_type,created_at FROM users WHERE id = ?`, id).Scan(
		&u.ID, &u.DisplayName, &u.Region, &u.Language, &u.Level, &u.RatingScore, &u.RatingTier, &u.Experience, &u.Credits, &u.Kills, &u.Deaths, &u.Wins, &u.Losses, &u.Matches, &lastSeen, &u.PenaltyType, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.LastSeenAt = parseStamp(lastSeen)
	u.CreatedAt = parseStamp(created)
	return u, nil
}

func (s *Store) UpdateUser(ctx context.Context, u *store.User) error {
	result, err := s.db.ExecContext(ctx, `UPDATE users SET display_name=?,region=?,language=?,level=?,rating_score=?,rating_tier=?,experience=?,credits=?,kills=?,deaths=?,wins=?,losses=?,matches=?,last_seen_at=?,penalty_type=? WHERE id=?`, u.DisplayName, u.Region, u.Language, u.Level, u.RatingScore, u.RatingTier, u.Experience, u.Credits, u.Kills, u.Deaths, u.Wins, u.Losses, u.Matches, stamp(u.LastSeenAt), u.PenaltyType, u.ID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) ListTasks(ctx context.Context, userID string, now time.Time) ([]store.Task, error) {
	if _, err := s.GetUser(ctx, userID); err != nil {
		return nil, err
	}
	if err := s.ensureTasks(ctx, userID, now); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT task_id,label,value,target,reward,claimed,tracked,expires_at FROM user_tasks WHERE user_id=?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []store.Task
	for rows.Next() {
		var t store.Task
		var claimed, tracked int
		var expires string
		if err := rows.Scan(&t.ID, &t.Label, &t.Value, &t.Target, &t.Reward, &claimed, &tracked, &expires); err != nil {
			return nil, err
		}
		t.Claimed, t.Tracked, t.ExpiresAt = claimed != 0, tracked != 0, parseStamp(expires)
		result = append(result, t)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, rows.Err()
}

func (s *Store) TrackTask(ctx context.Context, userID, taskID string) error {
	if _, err := s.ListTasks(ctx, userID, time.Now().UTC()); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE user_tasks SET tracked = CASE WHEN task_id=? THEN 1 ELSE 0 END, updated_at=? WHERE user_id=?`, taskID, stamp(time.Now().UTC()), userID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_tasks WHERE user_id=? AND task_id=?`, userID, taskID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) ClaimTask(ctx context.Context, userID, taskID string, now time.Time) (store.Task, error) {
	if _, err := s.ListTasks(ctx, userID, now); err != nil {
		return store.Task{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.Task{}, err
	}
	defer tx.Rollback()

	var task store.Task
	var claimed, tracked int
	var expires string
	err = tx.QueryRowContext(ctx, `SELECT task_id,label,value,target,reward,claimed,tracked,expires_at FROM user_tasks WHERE user_id=? AND task_id=?`, userID, taskID).Scan(
		&task.ID, &task.Label, &task.Value, &task.Target, &task.Reward, &claimed, &tracked, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return store.Task{}, store.ErrNotFound
	}
	if err != nil {
		return store.Task{}, err
	}
	task.Claimed, task.Tracked, task.ExpiresAt = claimed != 0, tracked != 0, parseStamp(expires)
	if now.After(task.ExpiresAt) {
		return store.Task{}, fmt.Errorf("任务已过期")
	}
	if task.Value < task.Target {
		return store.Task{}, fmt.Errorf("任务尚未完成")
	}
	if task.Claimed {
		if err := tx.Commit(); err != nil {
			return store.Task{}, err
		}
		return task, nil
	}
	result, err := tx.ExecContext(ctx, `UPDATE user_tasks SET claimed=1,updated_at=? WHERE user_id=? AND task_id=? AND claimed=0`, stamp(now.UTC()), userID, taskID)
	if err != nil {
		return store.Task{}, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return store.Task{}, err
	}
	if n == 0 {
		// 并发下已被其他请求领取，不再重复发奖。
		if err := tx.Commit(); err != nil {
			return store.Task{}, err
		}
		task.Claimed = true
		return task, nil
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET experience=experience+? WHERE id=?`, task.Reward, userID); err != nil {
		return store.Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.Task{}, err
	}
	task.Claimed = true
	return task, nil
}

func (s *Store) AdvanceTask(ctx context.Context, userID, taskID string, amount int, now time.Time) error {
	if amount <= 0 {
		return nil
	}
	if _, err := s.ListTasks(ctx, userID, now); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE user_tasks SET value=MIN(target,value+?),updated_at=? WHERE user_id=? AND task_id=? AND claimed=0 AND expires_at>?`, amount, stamp(now.UTC()), userID, taskID, stamp(now.UTC()))
	return err
}

func (s *Store) GetCheckIn(ctx context.Context, userID string, now time.Time) (store.CheckIn, error) {
	u, err := s.GetUser(ctx, userID)
	if err != nil {
		return store.CheckIn{}, err
	}
	lastDate, streak, err := s.readCheckIn(ctx, userID)
	if err != nil {
		return store.CheckIn{}, err
	}
	today := dayStamp(now)
	if lastDate != "" && lastDate != today && lastDate != dayStamp(now.Add(-24*time.Hour)) {
		streak = 0
	}
	nextStreak := streak + 1
	reward := checkInReward(nextStreak)
	return store.CheckIn{CheckedIn: lastDate == today, Date: today, CurrentStreak: streak, Reward: reward, Credits: u.Credits, NextReward: reward}, nil
}

func (s *Store) ClaimCheckIn(ctx context.Context, userID string, now time.Time) (store.CheckIn, error) {
	u, err := s.GetUser(ctx, userID)
	if err != nil {
		return store.CheckIn{}, err
	}
	today := dayStamp(now)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.CheckIn{}, err
	}
	defer tx.Rollback()
	var lastDate string
	var streak int
	err = tx.QueryRowContext(ctx, `SELECT last_date,streak FROM user_checkins WHERE user_id=?`, userID).Scan(&lastDate, &streak)
	if errors.Is(err, sql.ErrNoRows) {
		lastDate = ""
		streak = 0
	} else if err != nil {
		return store.CheckIn{}, err
	}
	if lastDate == today {
		return store.CheckIn{CheckedIn: true, Date: today, CurrentStreak: streak, Reward: 0, Credits: u.Credits, NextReward: checkInReward(streak + 1)}, nil
	}
	if lastDate == dayStamp(now.Add(-24*time.Hour)) {
		streak++
	} else {
		streak = 1
	}
	reward := checkInReward(streak)
	if _, err = tx.ExecContext(ctx, `INSERT INTO user_checkins(user_id,last_date,streak,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_date=excluded.last_date,streak=excluded.streak,updated_at=excluded.updated_at`, userID, today, streak, stamp(now.UTC())); err != nil {
		return store.CheckIn{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET credits=MIN(16000,credits+?),last_seen_at=? WHERE id=?`, reward, stamp(now.UTC()), userID); err != nil {
		return store.CheckIn{}, err
	}
	if err = tx.Commit(); err != nil {
		return store.CheckIn{}, err
	}
	u.Credits += reward
	if u.Credits > 16000 {
		u.Credits = 16000
	}
	return store.CheckIn{CheckedIn: true, Date: today, CurrentStreak: streak, Reward: reward, Credits: u.Credits, NextReward: checkInReward(streak + 1)}, nil
}

func (s *Store) readCheckIn(ctx context.Context, userID string) (string, int, error) {
	var date string
	var streak int
	err := s.db.QueryRowContext(ctx, `SELECT last_date,streak FROM user_checkins WHERE user_id=?`, userID).Scan(&date, &streak)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, nil
	}
	return date, streak, err
}

func checkInReward(streak int) int32 {
	values := []int32{100, 150, 200, 250, 300, 350, 500}
	if streak < 1 {
		streak = 1
	}
	if streak > len(values) {
		streak = len(values)
	}
	return values[streak-1]
}

func dayStamp(t time.Time) string { return t.UTC().Format("2006-01-02") }

func (s *Store) ensureTasks(ctx context.Context, userID string, now time.Time) error {
	expires := stamp(now.UTC().Add(24 * time.Hour))
	for _, t := range []struct {
		id, label      string
		target, reward int
		tracked        bool
	}{
		{"rifle-kill", "使用突击步枪完成击杀", 10, 2500, true},
		{"rounds", "完成对局", 2, 2500, false},
		{"headshot", "完成爆头击杀", 5, 5000, false},
		{"range", "完成训练场命中测验", 1, 750, false},
	} {
		tracked := 0
		if t.tracked {
			tracked = 1
		}
		// 已过期的每日任务自动重置进度与领取标记，并顺延到期时间。
		if _, err := s.db.ExecContext(ctx, `INSERT INTO user_tasks(user_id,task_id,label,target,reward,tracked,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
			ON CONFLICT(user_id,task_id) DO UPDATE SET
			label=excluded.label,
			target=excluded.target,
			reward=excluded.reward,
			tracked=user_tasks.tracked,
			expires_at=CASE WHEN user_tasks.expires_at < excluded.expires_at THEN excluded.expires_at ELSE user_tasks.expires_at END,
			value=CASE WHEN user_tasks.expires_at < excluded.expires_at THEN 0 ELSE user_tasks.value END,
			claimed=CASE WHEN user_tasks.expires_at < excluded.expires_at THEN 0 ELSE user_tasks.claimed END,
			updated_at=excluded.updated_at`,
			userID, t.id, t.label, t.target, t.reward, tracked, expires, stamp(now.UTC())); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func stamp(t time.Time) string {
	if t.IsZero() {
		t = time.Now().UTC()
	}
	return t.UTC().Format(time.RFC3339Nano)
}
func parseStamp(value string) time.Time { t, _ := time.Parse(time.RFC3339Nano, value); return t }
