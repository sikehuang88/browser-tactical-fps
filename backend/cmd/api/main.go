// 业务后端入口。默认内存 store，配置 --pg-dsn 后走 PostgreSQL（迁移见 migrations/）。
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/fpsweb/game/backend/internal/auth"
	"github.com/fpsweb/game/backend/internal/gameconfig"
	"github.com/fpsweb/game/backend/internal/matchmaking"
	"github.com/fpsweb/game/backend/internal/server"
	"github.com/fpsweb/game/backend/internal/store"
	"github.com/fpsweb/game/backend/internal/store/memory"
	"github.com/fpsweb/game/backend/internal/store/postgres"
	"github.com/fpsweb/game/backend/internal/user"
)

func main() {
	addr := flag.String("addr", ":8080", "监听地址")
	pgDSN := flag.String("pg-dsn", "", "PostgreSQL DSN（留空使用内存 store）")
	tokenSecret := flag.String("token-secret", "", "令牌签名密钥（留空自动生成随机密钥）")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	var st store.Store = memory.New()
	if *pgDSN != "" {
		if pg, err := postgres.New(*pgDSN); err == nil {
			st = pg
			logger.Info("已连接 PostgreSQL")
		} else {
			logger.Error("连接 PostgreSQL 失败，回退内存 store", "err", err)
		}
	} else {
		logger.Info("使用内存 store（未配置 --pg-dsn）")
	}
	defer st.Close()

	authMgr := auth.NewManager([]byte(*tokenSecret), 2*time.Hour)

	srv := server.New(server.Deps{
		Store:       st,
		Auth:        authMgr,
		Users:       user.New(st),
		Matchmaking: matchmaking.New(),
		GameConfig:  gameconfig.Default(),
		Logger:      logger,
	})

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	logger.Info("业务后端启动", "addr", *addr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("服务异常退出", "err", err)
		os.Exit(1)
	}
}
