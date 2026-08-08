# Web版战术竞技FPS 开发命令
# 注意：Windows 若无 make，可逐条执行各目标的命令（见 README「快速开始」）。
SHELL := bash

.PHONY: help client-dev client-build server-run backend-run net-sim dev build check

help:
	@echo "目标:"
	@echo "  make client-dev      启动 Web 客户端开发服务器 (Vite)"
	@echo "  make client-build    构建 Web 客户端产物"
	@echo "  make server-run      运行 Rust 实时服务器 (默认 :9000, 64 tick)"
	@echo "  make backend-run     运行 Go 业务后端 (默认 :8080)"
	@echo "  make dev             同时启动 backend + server + client"
	@echo "  make net-sim         运行网络模拟器 (延迟/丢包代理示例)"
	@echo "  make build           构建 client + server + backend"
	@echo "  make check           校验 client/server/backend 全部可编译"

client-dev:
	cd client && npm run dev

client-build:
	cd client && node scripts/check-assets-manifest.mjs && npm run build && node scripts/check-dist-size.mjs 35

server-run:
	cd server && cargo run -- --port 9000 --tick-rate 64

backend-run:
	cd backend && go run ./cmd/api --addr :8080

dev:
	cd backend && go run ./cmd/api --addr :8080 & \
	cd server && cargo run -- --port 9000 --tick-rate 64 & \
	cd client && npm run dev

net-sim:
	cd tools/net-sim && node index.js --help

build:
	cd client && npm run build
	cd server && cargo build --release
	cd backend && go build ./...

check:
	cd client && npx tsc --noEmit && node scripts/check-assets-manifest.mjs
	cd server && cargo build && cargo test --quiet
	cd backend && go build ./... && go test ./...
