// PostgreSQL store 骨架。迁移文件见 backend/migrations/。
// 骨架阶段以内存 store 支撑联调；接入时引入 pgx/lib-pq 并实现接口即可（不改动上层调用方）。
package postgres

import (
	"context"
	"errors"

	"github.com/fpsweb/game/backend/internal/store"
)

type Store struct{}

func New(dsn string) (*Store, error) {
	_ = dsn
	return nil, errors.New("PostgreSQL store 尚未实现（骨架阶段请使用内存 store，迁移见 backend/migrations/0001_init.sql）")
}

func (s *Store) CreateUser(context.Context, *store.User) error { return errors.New("未实现") }
func (s *Store) GetUser(context.Context, string) (*store.User, error) {
	return nil, errors.New("未实现")
}
func (s *Store) UpdateUser(context.Context, *store.User) error { return errors.New("未实现") }
func (s *Store) Close() error                                  { return nil }
