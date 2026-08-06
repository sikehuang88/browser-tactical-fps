// Package matchmaking 匹配队列桩（MATCH-001~003 的 M0 骨架）。
// 真实实现：Redis 队列 + 地区/技能分匹配 + 就绪确认，见 M2 里程碑。
package matchmaking

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
)

type Mode string

const (
	ModeCasual Mode = "casual"
	ModeRanked Mode = "ranked"
)

var ErrAlreadyQueued = errors.New("已在匹配队列中")

type Request struct {
	Mode      Mode   `json:"mode"`
	PartySize int    `json:"partySize"`
	Region    string `json:"region"`
}

type Result struct {
	QueueID  string `json:"queueId"`
	Status   string `json:"status"`
	Mode     Mode   `json:"mode"`
	Region   string `json:"region"`
	Position int    `json:"position"`
}

type Service struct {
	mu     sync.Mutex
	queued map[string]bool // 占位：防重复入队
}

func New() *Service {
	return &Service{queued: make(map[string]bool)}
}

// Enqueue 将用户加入队列（骨架返回占位结果，不真正组队）。
func (s *Service) Enqueue(_ context.Context, userID string, req Request) (*Result, error) {
	if req.Mode != ModeCasual && req.Mode != ModeRanked {
		return nil, errors.New("不支持的匹配模式")
	}
	size := req.PartySize
	if size < 1 || size > 5 {
		size = 1
	}
	if req.Region == "" {
		req.Region = "cn"
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.queued[userID] {
		return nil, ErrAlreadyQueued
	}
	s.queued[userID] = true

	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return &Result{
		QueueID:  "q_" + hex.EncodeToString(b),
		Status:   "queued",
		Mode:     req.Mode,
		Region:   req.Region,
		Position: len(s.queued),
	}, nil
}

// Cancel 退出队列。
func (s *Service) Cancel(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.queued, userID)
}
