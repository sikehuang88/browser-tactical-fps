/** 统一时间源，便于测试时替换为假时钟。 */
export class Clock {
  private readonly start: number

  constructor() {
    this.start = performance.now()
  }

  /** 当前毫秒时间。 */
  now(): number {
    return performance.now()
  }

  /** 自启动以来的毫秒数。 */
  elapsed(): number {
    return performance.now() - this.start
  }
}
