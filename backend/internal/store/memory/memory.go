// 内存 store：骨架阶段默认实现，进程重启即失。
// 与 PostgreSQL 实现的差异在于持久性；接口契约一致。
package memory

import (
	"context"
	"sync"

	"github.com/fpsweb/game/backend/internal/store"
)

type Store struct {
	mu    sync.RWMutex
	users map[string]*store.User
}

func New() *Store {
	return &Store{users: make(map[string]*store.User)}
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

func (s *Store) Close() error { return nil }
