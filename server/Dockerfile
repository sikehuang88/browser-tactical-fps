# 实时游戏服务器构建镜像（参考）
FROM rust:1-alpine AS build
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --bin fpsweb-server

FROM alpine:3.20
RUN adduser -D -u 10001 app
COPY --from=build /src/target/release/fpsweb-server /usr/local/bin/fpsweb-server
USER app
EXPOSE 9000
ENTRYPOINT ["fpsweb-server"]
