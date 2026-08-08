// 业务后端入口。默认使用本地 SQLite，保证玩家资料跨重启保留。
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
	"github.com/fpsweb/game/backend/internal/store/sqlite"
	"github.com/fpsweb/game/backend/internal/user"
)

func main() {
	addr := flag.String("addr", ":8080", "监听地址")
	dbPath := flag.String("db", "data/fpsweb.db", "SQLite 数据库文件路径")
	pgDSN := flag.String("pg-dsn", "", "PostgreSQL DSN（当前尚未实现，留空使用 SQLite）")
	tokenSecret := flag.String("token-secret", "", "令牌签名密钥（留空自动生成随机密钥）")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *pgDSN != "" {
		logger.Error("--pg-dsn 指定的 PostgreSQL store 尚未实现，请先使用 SQLite（--db）")
		os.Exit(1)
	}

	var st store.Store
	if db, err := sqlite.New(*dbPath); err == nil {
		st = db
		logger.Info("已连接 SQLite", "path", *dbPath)
	} else {
		logger.Error("SQLite 初始化失败", "err", err)
		os.Exit(1)
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
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	logger.Info("业务后端启动", "addr", *addr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("服务异常退出", "err", err)
		os.Exit(1)
	}
}
