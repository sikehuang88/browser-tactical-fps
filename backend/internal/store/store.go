// Package store 定义数据访问接口与核心实体。
// 骨架阶段提供内存实现；PostgreSQL 实现按迁移文件逐步落地（数据一致性见需求文档 10.2）。
package store

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound 资源不存在哨兵错误，各实现统一返回。
var ErrNotFound = errors.New("资源不存在")

type User struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	Region      string    `json:"region"`
	Language    string    `json:"language"`
	Level       int32     `json:"level"`
	RatingScore int32     `json:"ratingScore"`
	RatingTier  string    `json:"ratingTier"`
	Experience  int32     `json:"experience"`
	Credits     int32     `json:"credits"`
	Kills       int32     `json:"kills"`
	Deaths      int32     `json:"deaths"`
	Wins        int32     `json:"wins"`
	Losses      int32     `json:"losses"`
	Matches     int32     `json:"matches"`
	LastSeenAt  time.Time `json:"lastSeenAt"`
	PenaltyType string    `json:"penaltyType"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Task struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	Value     int       `json:"value"`
	Target    int       `json:"target"`
	Reward    int       `json:"reward"`
	Claimed   bool      `json:"claimed"`
	Tracked   bool      `json:"tracked"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type CheckIn struct {
	CheckedIn     bool   `json:"checkedIn"`
	Date          string `json:"date"`
	CurrentStreak int    `json:"currentStreak"`
	Reward        int32  `json:"reward"`
	Credits       int32  `json:"credits"`
	NextReward    int32  `json:"nextReward"`
}

type Store interface {
	CreateUser(ctx context.Context, u *User) error
	GetUser(ctx context.Context, id string) (*User, error)
	UpdateUser(ctx context.Context, u *User) error
	ListTasks(ctx context.Context, userID string, now time.Time) ([]Task, error)
	TrackTask(ctx context.Context, userID, taskID string) error
	ClaimTask(ctx context.Context, userID, taskID string, now time.Time) (Task, error)
	AdvanceTask(ctx context.Context, userID, taskID string, amount int, now time.Time) error
	GetCheckIn(ctx context.Context, userID string, now time.Time) (CheckIn, error)
	ClaimCheckIn(ctx context.Context, userID string, now time.Time) (CheckIn, error)
	Close() error
}
