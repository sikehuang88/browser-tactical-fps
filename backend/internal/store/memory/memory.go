// 内存 store：骨架阶段默认实现，进程重启即失。
// 与 PostgreSQL 实现的差异在于持久性；接口契约一致。
package memory

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/fpsweb/game/backend/internal/store"
)

type Store struct {
	mu       sync.RWMutex
	users    map[string]*store.User
	tasks    map[string]map[string]store.Task
	checkins map[string]struct {
		date   string
		streak int
	}
}

func New() *Store {
	return &Store{users: make(map[string]*store.User), tasks: make(map[string]map[string]store.Task), checkins: make(map[string]struct {
		date   string
		streak int
	})}
}

func (s *Store) CreateUser(_ context.Context, u *store.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.ID] = u
	return nil
}

func (s *Store) GetUser(_ context.Context, id string) (*store.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return u, nil
}

func (s *Store) UpdateUser(_ context.Context, u *store.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[u.ID]; !ok {
		return store.ErrNotFound
	}
	s.users[u.ID] = u
	return nil
}

func (s *Store) ListTasks(_ context.Context, userID string, now time.Time) ([]store.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return nil, store.ErrNotFound
	}
	s.ensureTasksLocked(userID, now)
	result := make([]store.Task, 0, len(s.tasks[userID]))
	for _, task := range s.tasks[userID] {
		result = append(result, task)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (s *Store) TrackTask(_ context.Context, userID, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return store.ErrNotFound
	}
	tasks := s.ensureTasksLocked(userID, time.Now())
	if _, ok := tasks[taskID]; !ok {
		return store.ErrNotFound
	}
	for id, task := range tasks {
		task.Tracked = id == taskID
		tasks[id] = task
	}
	return nil
}

func (s *Store) ClaimTask(_ context.Context, userID, taskID string, now time.Time) (store.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return store.Task{}, store.ErrNotFound
	}
	tasks := s.ensureTasksLocked(userID, now)
	task, ok := tasks[taskID]
	if !ok {
		return store.Task{}, store.ErrNotFound
	}
	if now.After(task.ExpiresAt) {
		return store.Task{}, fmt.Errorf("任务已过期")
	}
	if task.Value < task.Target {
		return store.Task{}, fmt.Errorf("任务尚未完成")
	}
	if task.Claimed {
		return task, nil
	}
	task.Claimed = true
	tasks[taskID] = task
	if user := s.users[userID]; user != nil {
		user.Experience += int32(task.Reward)
	}
	return task, nil
}

func (s *Store) AdvanceTask(_ context.Context, userID, taskID string, amount int, now time.Time) error {
	if amount <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return store.ErrNotFound
	}
	tasks := s.ensureTasksLocked(userID, now)
	task, ok := tasks[taskID]
	if !ok {
		return store.ErrNotFound
	}
	if task.Claimed || now.After(task.ExpiresAt) {
		return nil
	}
	task.Value = min(task.Target, task.Value+amount)
	tasks[taskID] = task
	return nil
}

func (s *Store) GetCheckIn(_ context.Context, userID string, now time.Time) (store.CheckIn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[userID]
	if !ok {
		return store.CheckIn{}, store.ErrNotFound
	}
	entry := s.checkins[userID]
	if entry.date != "" && entry.date != dayStamp(now) && entry.date != dayStamp(now.Add(-24*time.Hour)) {
		entry.streak = 0
	}
	next := entry.streak + 1
	reward := checkInReward(next)
	return store.CheckIn{CheckedIn: entry.date == dayStamp(now), Date: dayStamp(now), CurrentStreak: entry.streak, Reward: reward, Credits: u.Credits, NextReward: reward}, nil
}

func (s *Store) ClaimCheckIn(_ context.Context, userID string, now time.Time) (store.CheckIn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[userID]
	if !ok {
		return store.CheckIn{}, store.ErrNotFound
	}
	today := dayStamp(now)
	entry := s.checkins[userID]
	if entry.date == today {
		return store.CheckIn{CheckedIn: true, Date: today, CurrentStreak: entry.streak, Reward: 0, Credits: u.Credits, NextReward: checkInReward(entry.streak + 1)}, nil
	}
	if entry.date == dayStamp(now.Add(-24*time.Hour)) {
		entry.streak++
	} else {
		entry.streak = 1
	}
	entry.date = today
	s.checkins[userID] = entry
	reward := checkInReward(entry.streak)
	u.Credits += reward
	if u.Credits > 16000 {
		u.Credits = 16000
	}
	return store.CheckIn{CheckedIn: true, Date: today, CurrentStreak: entry.streak, Reward: reward, Credits: u.Credits, NextReward: checkInReward(entry.streak + 1)}, nil
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

func (s *Store) ensureTasksLocked(userID string, now time.Time) map[string]store.Task {
	expires := now.UTC().Add(24 * time.Hour)
	if tasks, ok := s.tasks[userID]; ok {
		for id, task := range tasks {
			if now.After(task.ExpiresAt) {
				task.Value = 0
				task.Claimed = false
				task.ExpiresAt = expires
				tasks[id] = task
			}
		}
		return tasks
	}
	tasks := map[string]store.Task{
		"rifle-kill": {ID: "rifle-kill", Label: "使用突击步枪完成击杀", Target: 10, Reward: 2500, Tracked: true, ExpiresAt: expires},
		"rounds":     {ID: "rounds", Label: "完成对局", Target: 2, Reward: 2500, ExpiresAt: expires},
		"headshot":   {ID: "headshot", Label: "完成爆头击杀", Target: 5, Reward: 5000, ExpiresAt: expires},
		"range":      {ID: "range", Label: "完成训练场命中测验", Target: 1, Reward: 750, ExpiresAt: expires},
	}
	s.tasks[userID] = tasks
	return tasks
}

func (s *Store) Close() error { return nil }
