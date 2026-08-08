//! 服务器配置：命令行参数解析（避免引入 clap，M0 手工解析）。

/// 服务器运行配置。
#[derive(Clone, Debug)]
pub struct Config {
    pub addr: String,
    pub port: u16,
    pub tick_rate: u32,
    pub max_players: usize,
    pub max_connections: usize,
    pub protocol_version: u8,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            addr: "0.0.0.0:9000".to_string(),
            port: 9000,
            tick_rate: 64,
            max_players: 10,
            max_connections: 128,
            protocol_version: crate::protocol::PROTOCOL_VERSION,
        }
    }
}

impl Config {
    /// 解析 `--port` `--tick-rate` `--max-players` `--max-connections` 参数。
    pub fn parse() -> Config {
        let mut cfg = Config::default();
        let args: Vec<String> = std::env::args().collect();
        let mut i = 1;
        while i < args.len() {
            let next = args.get(i + 1).cloned();
            match args[i].as_str() {
                "--port" => {
                    if let Some(v) = next {
                        cfg.port = v.parse().unwrap_or(cfg.port);
                    }
                    i += 1;
                }
                "--tick-rate" => {
                    if let Some(v) = next {
                        cfg.tick_rate = v
                            .parse::<u32>()
                            .ok()
                            .filter(|rate| (1..=1000).contains(rate))
                            .unwrap_or(cfg.tick_rate);
                    }
                    i += 1;
                }
                "--max-players" => {
                    if let Some(v) = next {
                        cfg.max_players = v.parse().unwrap_or(cfg.max_players);
                    }
                    i += 1;
                }
                "--max-connections" => {
                    if let Some(v) = next {
                        cfg.max_connections = v.parse().unwrap_or(cfg.max_connections);
                    }
                    i += 1;
                }
                "--help" | "-h" => {
                    println!(
                        "用法: fpsweb-server [--port 9000] [--tick-rate 64] [--max-players 10] [--max-connections 128]\n\
                         服务器权威模拟频率默认 64 tick/s，可在压测环境切换 32/128。"
                    );
                    std::process::exit(0);
                }
                _ => {}
            }
            i += 1;
        }
        cfg.addr = format!("0.0.0.0:{}", cfg.port);
        cfg
    }
}
