package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"sync"
	"time"
)

type ctxKey int

const (
	ctxKeyRequestID ctxKey = iota
	ctxKeyUserID
)

// statusRecorder 记录响应状态码，供访问日志使用。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := newRequestID()
		w.Header().Set("X-Request-Id", requestID)
		ctx := context.WithValue(r.Context(), ctxKeyRequestID, requestID)

		if !s.limiter.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "rate_limited", "请求过于频繁", requestID)
			return
		}

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()

		defer func() {
			if err := recover(); err != nil {
				s.deps.Logger.Error("panic", "err", err, "requestId", requestID)
				writeError(rec, http.StatusInternalServerError, "internal", "服务器内部错误", requestID)
			}
		}()

		next.ServeHTTP(rec, r.WithContext(ctx))

		s.deps.Logger.Info("http",
			"requestId", requestID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"durMs", time.Since(start).Milliseconds(),
			"ip", clientIP(r),
		)
	})
}

// requireAuth 校验 Bearer 访问令牌并注入 userID。
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reqID := requestIDFrom(r)
		token := bearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "缺少访问令牌", reqID)
			return
		}
		userID, err := s.deps.Auth.Verify(token, time.Now())
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "令牌无效或已过期", reqID)
			return
		}
		ctx := context.WithValue(r.Context(), ctxKeyUserID, userID)
		next(w, r.WithContext(ctx))
	}
}

// rateLimiter 固定窗口限频（SEC-001 频率限制的骨架实现）。
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]int
	start  time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, hits: make(map[string]int), start: time.Now()}
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if time.Since(rl.start) > rl.window {
		rl.hits = make(map[string]int)
		rl.start = time.Now()
	}
	rl.hits[ip]++
	return rl.hits[ip] <= rl.limit
}

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func requestIDFrom(r *http.Request) string {
	if v, ok := r.Context().Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

func userIDFrom(r *http.Request) string {
	if v, ok := r.Context().Value(ctxKeyUserID).(string); ok {
		return v
	}
	return ""
}
