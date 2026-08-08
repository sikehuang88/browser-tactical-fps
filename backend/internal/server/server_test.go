package server

import "testing"

func TestAllowedOriginsFromEnv(t *testing.T) {
	t.Setenv("FPSWEB_ALLOWED_ORIGINS", "https://game.example.com, https://cdn.example.com")
	got := allowedOriginsFromEnv()
	if len(got) != 2 {
		t.Fatalf("应解析出 2 个来源，实际 %d: %v", len(got), got)
	}
	if !got["https://game.example.com"] || !got["https://cdn.example.com"] {
		t.Fatalf("解析结果不符合预期: %v", got)
	}

	t.Setenv("FPSWEB_ALLOWED_ORIGINS", "")
	fallback := allowedOriginsFromEnv()
	if !fallback["http://localhost:5173"] || !fallback["http://tauri.localhost"] {
		t.Fatalf("未配置时应回落本地白名单: %v", fallback)
	}
}
