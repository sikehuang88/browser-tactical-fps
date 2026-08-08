package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/fpsweb/game/backend/internal/store"
)

func TestProfileAndTasksSurviveReopen(t *testing.T) {
	path := t.TempDir() + "/game.db"
	ctx := context.Background()
	first, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	u := &store.User{ID: "g_sqlite", DisplayName: "sqlite-user", Region: "my", Language: "en", Level: 4, RatingScore: 1100, Credits: 2450, CreatedAt: time.Now().UTC(), LastSeenAt: time.Now().UTC()}
	if err := first.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if _, err := first.ListTasks(ctx, u.ID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	got, err := second.GetUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Credits != 2450 || got.Level != 4 {
		t.Fatalf("profile lost after reopen: %+v", got)
	}
	tasks, err := second.ListTasks(ctx, u.ID, time.Now().UTC())
	if err != nil || len(tasks) != 4 {
		t.Fatalf("tasks lost after reopen: %d %v", len(tasks), err)
	}
}

func TestDailyCheckInPersistsAndDoesNotDoubleReward(t *testing.T) {
	path := filepath.Join(t.TempDir(), "checkin.db")
	st, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	u := &store.User{ID: "g_checkin", DisplayName: "checkin-user", Region: "cn", Language: "zh-CN", Level: 1, RatingScore: 1000, Credits: 2450, CreatedAt: now, LastSeenAt: now}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}

	first, err := st.ClaimCheckIn(ctx, u.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if first.Reward != 100 || first.Credits != 2550 || first.CurrentStreak != 1 {
		t.Fatalf("unexpected first check-in: %+v", first)
	}
	second, err := st.ClaimCheckIn(ctx, u.ID, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second.Reward != 0 || second.Credits != 2550 {
		t.Fatalf("duplicate check-in rewarded: %+v", second)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	status, err := reopened.GetCheckIn(ctx, u.ID, now.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !status.CheckedIn || status.CurrentStreak != 1 || status.Credits != 2550 {
		t.Fatalf("check-in did not persist: %+v", status)
	}
}

func TestClaimTaskAwardsExperienceOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claim.db")
	st, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	u := &store.User{ID: "g_claim", DisplayName: "claim-user", Region: "cn", Language: "zh-CN", Level: 1, RatingScore: 1000, Credits: 2450, CreatedAt: now, LastSeenAt: now}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := st.AdvanceTask(ctx, u.ID, "rifle-kill", 10, now); err != nil {
		t.Fatal(err)
	}

	first, err := st.ClaimTask(ctx, u.ID, "rifle-kill", now)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Claimed {
		t.Fatalf("first claim should mark task claimed: %+v", first)
	}
	if _, err := st.ClaimTask(ctx, u.ID, "rifle-kill", now); err != nil {
		t.Fatal(err)
	}

	got, err := st.GetUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Experience != int32(first.Reward) {
		t.Fatalf("experience awarded twice: got %d want %d", got.Experience, first.Reward)
	}
}

func TestExpiredTasksResetOnNextDay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tasks.db")
	st, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	u := &store.User{ID: "g_tasks", DisplayName: "tasks-user", Region: "cn", Language: "zh-CN", Level: 1, RatingScore: 1000, Credits: 2450, CreatedAt: now, LastSeenAt: now}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := st.AdvanceTask(ctx, u.ID, "rounds", 2, now); err != nil {
		t.Fatal(err)
	}
	// 模拟任务过期且已领取，次日应重置。
	if _, err := st.db.Exec(`UPDATE user_tasks SET claimed=1, expires_at=? WHERE user_id=? AND task_id=?`, stamp(now.Add(-time.Hour)), u.ID, "rounds"); err != nil {
		t.Fatal(err)
	}

	tasks, err := st.ListTasks(ctx, u.ID, now.Add(25*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if task.ID != "rounds" {
			continue
		}
		if task.Value != 0 || task.Claimed || !task.ExpiresAt.After(now) {
			t.Fatalf("expired task not reset: %+v", task)
		}
		return
	}
	t.Fatal("rounds task missing")
}
