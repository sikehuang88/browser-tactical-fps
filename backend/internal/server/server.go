// Package server 提供业务 HTTP API：认证、资料、匹配桩、配置。
// 实时对局链路与业务 API 隔离（架构原则 2）。
package server

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
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
	deps           Deps
	limiter        *rateLimiter
	allowedOrigins map[string]bool
}

func New(deps Deps) *Server {
	if deps.Logger == nil {
		deps.Logger = slog.Default()
	}
	return &Server{
		deps:           deps,
		limiter:        newRateLimiter(120, time.Minute),
		allowedOrigins: allowedOriginsFromEnv(),
	}
}

// allowedOriginsFromEnv 读取 FPSWEB_ALLOWED_ORIGINS（逗号分隔），未配置时使用本地开发白名单。
func allowedOriginsFromEnv() map[string]bool {
	defaults := map[string]bool{
		"http://localhost:5173":  true,
		"http://127.0.0.1:5173":  true,
		"http://localhost:5174":  true,
		"http://127.0.0.1:5174":  true,
		"http://tauri.localhost": true,
		"tauri://localhost":      true,
	}
	raw := strings.TrimSpace(os.Getenv("FPSWEB_ALLOWED_ORIGINS"))
	if raw == "" {
		return defaults
	}
	result := make(map[string]bool)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			result[part] = true
		}
	}
	if len(result) == 0 {
		return defaults
	}
	return result
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/v1/config", s.handleConfig)
	mux.HandleFunc("POST /api/v1/auth/guest", s.handleGuestLogin)
	mux.HandleFunc("GET /api/v1/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("GET /api/v1/tasks", s.requireAuth(s.handleTasks))
	mux.HandleFunc("GET /api/v1/checkin", s.requireAuth(s.handleCheckIn))
	mux.HandleFunc("POST /api/v1/checkin", s.requireAuth(s.handleClaimCheckIn))
	mux.HandleFunc("POST /api/v1/tasks/{taskID}/track", s.requireAuth(s.handleTrackTask))
	mux.HandleFunc("POST /api/v1/tasks/{taskID}/claim", s.requireAuth(s.handleClaimTask))
	mux.HandleFunc("POST /api/v1/matchmaking/queue", s.requireAuth(s.handleMatchmakingQueue))
	mux.HandleFunc("DELETE /api/v1/matchmaking/queue", s.requireAuth(s.handleMatchmakingCancel))
	return s.middleware(mux)
}
