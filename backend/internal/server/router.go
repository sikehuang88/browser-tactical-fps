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
	if err := readJSON(w, r, &body); err != nil {
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

func (s *Server) handleTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.deps.Store.ListTasks(r.Context(), userIDFrom(r), time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tasks_unavailable", "任务服务不可用", requestIDFrom(r))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) handleCheckIn(w http.ResponseWriter, r *http.Request) {
	checkIn, err := s.deps.Store.GetCheckIn(r.Context(), userIDFrom(r), time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "checkin_unavailable", "签到服务不可用", requestIDFrom(r))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"checkIn": checkIn})
}

func (s *Server) handleClaimCheckIn(w http.ResponseWriter, r *http.Request) {
	checkIn, err := s.deps.Store.ClaimCheckIn(r.Context(), userIDFrom(r), time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusConflict, "checkin_failed", "签到失败", requestIDFrom(r))
		return
	}
	s.audit(r, "daily_checkin", userIDFrom(r))
	writeJSON(w, http.StatusOK, map[string]any{"checkIn": checkIn})
}

func (s *Server) handleTrackTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("taskID")
	if taskID == "" || len(taskID) > 64 {
		writeError(w, http.StatusBadRequest, "invalid_task", "任务编号无效", requestIDFrom(r))
		return
	}
	if err := s.deps.Store.TrackTask(r.Context(), userIDFrom(r), taskID); err != nil {
		writeError(w, http.StatusBadRequest, "task_not_found", "任务不存在", requestIDFrom(r))
		return
	}
	s.audit(r, "task_track", userIDFrom(r))
	s.handleTasks(w, r)
}

func (s *Server) handleClaimTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("taskID")
	task, err := s.deps.Store.ClaimTask(r.Context(), userIDFrom(r), taskID, time.Now())
	if err != nil {
		reqID := requestIDFrom(r)
		s.deps.Logger.Error("claim task failed", "err", err, "requestId", reqID, "userId", userIDFrom(r))
		writeError(w, http.StatusConflict, "task_not_ready", "任务尚未完成、已过期或已领取", reqID)
		return
	}
	s.audit(r, "task_claim", userIDFrom(r))
	writeJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (s *Server) handleMatchmakingQueue(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r)
	var body matchmaking.Request
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "请求体无效", reqID)
		return
	}
	res, err := s.deps.Matchmaking.Enqueue(r.Context(), userIDFrom(r), body)
	if err != nil {
		if errors.Is(err, matchmaking.ErrAlreadyQueued) {
			writeError(w, http.StatusConflict, "already_queued", "已在匹配队列中", reqID)
			return
		}
		s.deps.Logger.Error("matchmaking enqueue failed", "err", err, "requestId", reqID, "userId", userIDFrom(r))
		writeError(w, http.StatusBadRequest, "invalid_request", "匹配请求无效", reqID)
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

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10) // 64KB
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
