// Package server 提供业务 HTTP API：认证、资料、匹配桩、配置。
// 实时对局链路与业务 API 隔离（架构原则 2）。
package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/fpsweb/game/backend/internal/auth"
	"github.com/fpsweb/game/backend/internal/gameconfig"
	"github.com/fpsweb/game/backend/internal/matchmaking"
	"github.com/fpsweb/game/backend/internal/store"
	"github.com/fpsweb/game/backend/internal/user"
)

type Deps struct {
	Store       store.Store
	Auth        *auth.Manager
	Users       *user.Service
	Matchmaking *matchmaking.Service
	GameConfig  *gameconfig.Config
	Logger      *slog.Logger
}

type Server struct {
	deps    Deps
	limiter *rateLimiter
}

func New(deps Deps) *Server {
	if deps.Logger == nil {
		deps.Logger = slog.Default()
	}
	return &Server{
		deps:    deps,
		limiter: newRateLimiter(120, time.Minute),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/v1/config", s.handleConfig)
	mux.HandleFunc("POST /api/v1/auth/guest", s.handleGuestLogin)
	mux.HandleFunc("GET /api/v1/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/v1/matchmaking/queue", s.requireAuth(s.handleMatchmakingQueue))
	mux.HandleFunc("DELETE /api/v1/matchmaking/queue", s.requireAuth(s.handleMatchmakingCancel))
	return s.middleware(mux)
}
