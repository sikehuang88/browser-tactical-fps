package memory

import (
	"context"
	"testing"
	"time"

	"github.com/fpsweb/game/backend/internal/store"
)

func TestTasksAreServerOwnedAndClaimable(t *testing.T) {
	ctx := context.Background()
	st := New()
	user := &store.User{ID: "g_test", DisplayName: "test"}
	if err := st.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}

	tasks, err := st.ListTasks(ctx, user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if task.Value != 0 {
			t.Fatalf("task %s started with non-zero progress", task.ID)
		}
	}
	if err := st.TrackTask(ctx, user.ID, "headshot"); err != nil {
		t.Fatal(err)
	}
	tasks, err = st.ListTasks(ctx, user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if task.Tracked != (task.ID == "headshot") {
			t.Fatalf("tracking mismatch for %s", task.ID)
		}
	}
	if _, err := st.ClaimTask(ctx, user.ID, "headshot", time.Now()); err == nil {
		t.Fatal("incomplete task was claimable")
	}
	for i := 0; i < 5; i++ {
		if err := st.AdvanceTask(ctx, user.ID, "headshot", 1, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	claimed, err := st.ClaimTask(ctx, user.ID, "headshot", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !claimed.Claimed || claimed.Value != claimed.Target {
		t.Fatalf("unexpected claimed task: %+v", claimed)
	}
	if user.Experience != int32(claimed.Reward) {
		t.Fatalf("experience not awarded: %d", user.Experience)
	}
}

func TestUserProfileFieldsPersist(t *testing.T) {
	ctx := context.Background()
	st := New()
	u := &store.User{ID: "g_profile", DisplayName: "profile", Credits: 2450, Matches: 3, LastSeenAt: time.Now().UTC()}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	u.Credits = 1800
	u.Wins = 2
	if err := st.UpdateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Credits != 1800 || got.Wins != 2 || got.Matches != 3 {
		t.Fatalf("profile fields did not persist: %+v", got)
	}
}
