// Package user 提供用户资料服务。
package user

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/fpsweb/game/backend/internal/store"
)

var ErrNotFound = errors.New("用户不存在")

type Service struct {
	store store.Store
}

func New(st store.Store) *Service {
	return &Service{store: st}
}

// GetOrCreateGuest 按设备 ID 获取或创建游客用户（AUTH-001）。
// 游客账户稳定映射到确定性 ID；正式账号接入后与 OAuth 账户打通。
func (s *Service) GetOrCreateGuest(ctx context.Context, deviceID, language string) (*store.User, error) {
	id := guestID(deviceID)
	u, err := s.store.GetUser(ctx, id)
	if err == nil {
		u.LastSeenAt = time.Now().UTC()
		_ = s.store.UpdateUser(ctx, u)
		return u, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}

	u = &store.User{
		ID:          id,
		DisplayName: "游客" + id[:6],
		Region:      "cn",
		Language:    defaultLang(language),
		Level:       1,
		RatingScore: 1000,
		RatingTier:  "unranked",
		Credits:     2450,
		LastSeenAt:  time.Now().UTC(),
		CreatedAt:   time.Now().UTC(),
	}
	if err := s.store.CreateUser(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Service) Get(ctx context.Context, id string) (*store.User, error) {
	u, err := s.store.GetUser(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return u, nil
}

func guestID(deviceID string) string {
	sum := sha256.Sum256([]byte("guest:" + deviceID))
	return "g_" + hex.EncodeToString(sum[:8])
}

func defaultLang(l string) string {
	if l == "" || len(l) > 8 {
		return "zh-CN"
	}
	return l
}
