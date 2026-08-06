// Package auth 提供短期访问令牌的签发与校验（HMAC-SHA256 签名）。
// M0/M1 占位方案；正式接入第三方 OAuth/OIDC 后由身份提供方签发（AUTH-002）。
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const tokenHeader = `{"alg":"HS256","typ":"FPSWEB"}`

type claims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

type Manager struct {
	secret []byte
	ttl    time.Duration
}

func NewManager(secret []byte, ttl time.Duration) *Manager {
	if len(secret) == 0 {
		secret = make([]byte, 32)
		_, _ = rand.Read(secret) // 未显式配置时生成随机密钥（重启后旧令牌失效）
	}
	if ttl <= 0 {
		ttl = 2 * time.Hour
	}
	return &Manager{secret: secret, ttl: ttl}
}

// Issue 为指定用户签发访问令牌。
func (m *Manager) Issue(userID string, now time.Time) (string, error) {
	payload, err := json.Marshal(claims{Sub: userID, Exp: now.Add(m.ttl).Unix()})
	if err != nil {
		return "", err
	}
	hp := b64(tokenHeader) + "." + b64(string(payload))
	return hp + "." + m.sign(hp), nil
}

// Verify 校验令牌并返回用户 ID。过期/篡改/格式错误均拒绝。
func (m *Manager) Verify(token string, now time.Time) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("令牌格式错误")
	}
	hp := parts[0] + "." + parts[1]
	want := m.sign(hp)
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return "", errors.New("签名校验失败")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("令牌负载无效")
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return "", errors.New("令牌负载无效")
	}
	if now.Unix() > c.Exp {
		return "", errors.New("令牌已过期")
	}
	return c.Sub, nil
}

func (m *Manager) sign(hp string) string {
	h := hmac.New(sha256.New, m.secret)
	_, _ = h.Write([]byte(hp))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func b64(s string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}
