package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"math"
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
		s.applyCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
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

// applyCORS 仅放行已知前端来源，避免任意站点跨域读取业务 API。
func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" && s.allowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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

// rateLimiter 每 IP 令牌桶限频（SEC-001：平滑突发，无固定窗口边界放大）。
type rateLimiter struct {
	mu      sync.Mutex
	limit   float64
	refill  float64
	buckets map[string]*tokenBucket
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:   float64(limit),
		refill:  float64(limit) / window.Seconds(),
		buckets: make(map[string]*tokenBucket),
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	bucket, ok := rl.buckets[ip]
	if !ok {
		bucket = &tokenBucket{tokens: rl.limit, last: now}
		rl.buckets[ip] = bucket
	}
	bucket.tokens = math.Min(rl.limit, bucket.tokens+now.Sub(bucket.last).Seconds()*rl.refill)
	bucket.last = now
	if bucket.tokens < 1 {
		return false
	}
	bucket.tokens--
	// 简单防内存膨胀：异常大的 IP 集合直接重置。
	if len(rl.buckets) > 10000 {
		rl.buckets = make(map[string]*tokenBucket)
	}
	return true
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
