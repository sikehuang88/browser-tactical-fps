// PostgreSQL store 骨架。迁移文件见 backend/migrations/。
// 骨架阶段以内存 store 支撑联调；接入时引入 pgx/lib-pq 并实现接口即可（不改动上层调用方）。
package postgres

import (
	"context"
	"errors"
	"time"

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
func (s *Store) ListTasks(context.Context, string, time.Time) ([]store.Task, error) {
	return nil, errors.New("任务 PostgreSQL store 尚未实现")
}
func (s *Store) TrackTask(context.Context, string, string) error {
	return errors.New("任务 PostgreSQL store 尚未实现")
}
func (s *Store) ClaimTask(context.Context, string, string, time.Time) (store.Task, error) {
	return store.Task{}, errors.New("任务 PostgreSQL store 尚未实现")
}
func (s *Store) AdvanceTask(context.Context, string, string, int, time.Time) error {
	return errors.New("任务 PostgreSQL store 尚未实现")
}
func (s *Store) GetCheckIn(context.Context, string, time.Time) (store.CheckIn, error) {
	return store.CheckIn{}, errors.New("签到 PostgreSQL store 尚未实现")
}
func (s *Store) ClaimCheckIn(context.Context, string, time.Time) (store.CheckIn, error) {
	return store.CheckIn{}, errors.New("签到 PostgreSQL store 尚未实现")
}
func (s *Store) GetTracerLoadout(context.Context, string) (store.TracerLoadout, error) {
	return store.TracerLoadout{}, errors.New("曳光弹 PostgreSQL store 尚未实现")
}
func (s *Store) PurchaseTracer(context.Context, string, string, int32, time.Time) (store.TracerLoadout, error) {
	return store.TracerLoadout{}, errors.New("曳光弹 PostgreSQL store 尚未实现")
}
func (s *Store) EquipTracer(context.Context, string, string) (store.TracerLoadout, error) {
	return store.TracerLoadout{}, errors.New("曳光弹 PostgreSQL store 尚未实现")
}
func (s *Store) Close() error { return nil }
