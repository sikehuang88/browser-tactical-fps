package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/fpsweb/game/backend/internal/matchmaking"
)

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.deps.GameConfig)
}

// handleGuestLogin 游客登录：deviceId → 确定性游客账户 + 短期访问令牌（AUTH-001）。
func (s *Server) handleGuestLogin(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r)
	var body struct {
		DeviceID string `json:"deviceId"`
		Language string `json:"language"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "请求体无效", reqID)
		return
	}
	if body.DeviceID == "" || len(body.DeviceID) > 128 {
		writeError(w, http.StatusBadRequest, "invalid_device", "deviceId 缺失或过长", reqID)
		return
	}

	u, err := s.deps.Users.GetOrCreateGuest(r.Context(), body.DeviceID, body.Language)
	if err != nil {
		s.deps.Logger.Error("游客登录失败", "err", err, "requestId", reqID)
		writeError(w, http.StatusInternalServerError, "internal", "登录失败", reqID)
		return
	}
	token, err := s.deps.Auth.Issue(u.ID, time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "令牌签发失败", reqID)
		return
	}
	s.audit(r, "guest_login", u.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"accessToken":      token,
		"expiresInSeconds": 7200,
		"profile":          u,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := s.deps.Users.Get(r.Context(), userIDFrom(r))
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在", requestIDFrom(r))
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleMatchmakingQueue(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r)
	var body matchmaking.Request
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "请求体无效", reqID)
		return
	}
	res, err := s.deps.Matchmaking.Enqueue(r.Context(), userIDFrom(r), body)
	if err != nil {
		if errors.Is(err, matchmaking.ErrAlreadyQueued) {
			writeError(w, http.StatusConflict, "already_queued", "已在匹配队列中", reqID)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error(), reqID)
		return
	}
	s.audit(r, "matchmaking_enqueue", userIDFrom(r))
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleMatchmakingCancel(w http.ResponseWriter, r *http.Request) {
	s.deps.Matchmaking.Cancel(userIDFrom(r))
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// audit 记录关键操作审计日志（SEC-002：登录、匹配等必须记录）。
func (s *Server) audit(r *http.Request, action, userID string) {
	s.deps.Logger.Info("audit",
		"requestId", requestIDFrom(r),
		"action", action,
		"userId", userID,
		"ip", clientIP(r),
	)
}

// ---------- helpers ----------

func readJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 64<<10) // 64KB
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	// 拒绝多余内容
	if dec.More() {
		return io.EOF
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError 统一错误格式，不暴露内部细节（接口规范）。
func writeError(w http.ResponseWriter, status int, code, message, requestID string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":      code,
			"message":   message,
			"requestId": requestID,
		},
	})
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}
