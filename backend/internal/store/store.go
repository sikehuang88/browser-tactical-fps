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
	PenaltyType string    `json:"penaltyType"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Store interface {
	CreateUser(ctx context.Context, u *User) error
	GetUser(ctx context.Context, id string) (*User, error)
	UpdateUser(ctx context.Context, u *User) error
	Close() error
}
