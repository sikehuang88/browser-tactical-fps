//! 模拟循环遥测：tick 耗时统计（对应 OBS-003）。M0 输出平均/最大/P99，后续接 Prometheus。

use std::time::Duration;

pub struct TickStats {
    period: u32,
    count: u32,
    total: Duration,
    max: Duration,
    samples: Vec<u32>, // 微秒
    input_lag_total: u32,
    input_lag_count: u32,
    input_lag_max: u32,
}

impl TickStats {
    pub fn new(period: u32) -> Self {
        Self {
            period,
            count: 0,
            total: Duration::ZERO,
            max: Duration::ZERO,
            samples: Vec::with_capacity(period as usize),
            input_lag_total: 0,
            input_lag_count: 0,
            input_lag_max: 0,
        }
    }

    /// 记录输入帧从客户端发出到服务器处理的延迟（OBS-003 输入延迟指标）。
    pub fn record_input_lag(&mut self, lag_ms: u32) {
        self.input_lag_total += lag_ms;
        self.input_lag_count += 1;
        self.input_lag_max = self.input_lag_max.max(lag_ms);
    }

    pub fn record(&mut self, d: Duration) {
        self.count += 1;
        self.total += d;
        self.max = self.max.max(d);
        self.samples.push(d.as_micros() as u32);
    }

    pub fn log_and_reset(&mut self) {
        if self.count == 0 {
            return;
        }
        let avg_us = self.total.as_micros() as f64 / self.count as f64;
        self.samples.sort_unstable();
        let p99 = self
            .samples
            .get(((self.samples.len() as f64) * 0.99) as usize)
            .copied()
            .unwrap_or(0);
        let max_ms = self.max.as_secs_f64() * 1000.0;
        let avg_ms = avg_us / 1000.0;
        let input_lag = if self.input_lag_count > 0 {
            format!(
                " · 输入延迟 avg={}ms max={}ms",
                self.input_lag_total / self.input_lag_count,
                self.input_lag_max
            )
        } else {
            String::new()
        };
        log::info!(
            "tick: avg={avg_ms:.3}ms max={max_ms:.3}ms p99={p99}us over {} ticks ({} tick/s){input_lag}",
            self.count,
            self.period
        );
        self.count = 0;
        self.total = Duration::ZERO;
        self.max = Duration::ZERO;
        self.samples.clear();
        self.input_lag_total = 0;
        self.input_lag_count = 0;
        self.input_lag_max = 0;
    }
}
