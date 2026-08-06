//! fpsweb-server 入口：解析配置，启动 64 tick 权威模拟循环与 WebSocket 接入。

mod config;
mod protocol;
mod server;
mod sim;
mod telemetry;

use config::Config;
use std::error::Error;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    env_logger::init();
    let cfg = Config::parse();
    log::info!(
        "fpsweb-server {} 启动: {} · {} tick/s · 快照约 {}Hz · 协议 v{}",
        env!("CARGO_PKG_VERSION"),
        cfg.addr,
        cfg.tick_rate,
        32,
        cfg.protocol_version
    );

    let listener = TcpListener::bind(&cfg.addr).await?;
    let (inbound_tx, inbound_rx) = mpsc::channel::<server::InboundMsg>(1024);

    // 权威模拟循环（独立任务，与连接处理解耦）
    tokio::spawn(server::run_tick_loop(cfg.clone(), inbound_rx));

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, addr) = accepted?;
                let tx = inbound_tx.clone();
                let cfg = cfg.clone();
                tokio::spawn(server::handle_connection(stream, addr, tx, cfg));
            }
            _ = tokio::signal::ctrl_c() => {
                log::info!("收到 Ctrl-C，关闭中");
                break;
            }
        }
    }

    Ok(())
}
