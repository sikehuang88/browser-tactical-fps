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

// ErrInsufficientCredits 余额不足以完成购买。
var ErrInsufficientCredits = errors.New("余额不足")

// ErrNotOwned 尚未拥有该物品，不能装备。
var ErrNotOwned = errors.New("尚未拥有该物品")

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

// TracerLoadout 是玩家的曳光弹持有与装备状态。
// Owned 只含数据库中记录的购买项；免费默认项由服务层按目录补齐。
type TracerLoadout struct {
	Owned      []string `json:"owned"`
	EquippedID string   `json:"equippedId"`
	Credits    int32    `json:"credits"`
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
	// GetTracerLoadout 读取持有与装备状态；EquippedID 为空表示未选择，由调用方回退到默认项。
	GetTracerLoadout(ctx context.Context, userID string) (TracerLoadout, error)
	// PurchaseTracer 扣费并授予物品。price 由服务层从权威目录解析，绝不来自请求体。
	// 实现必须幂等：已拥有时直接返回当前状态且不重复扣费。
	PurchaseTracer(ctx context.Context, userID, itemID string, price int32, now time.Time) (TracerLoadout, error)
	// EquipTracer 装备已拥有的物品；未拥有返回 ErrNotOwned。
	EquipTracer(ctx context.Context, userID, itemID string) (TracerLoadout, error)
	Close() error
}
