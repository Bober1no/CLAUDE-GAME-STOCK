/** Token bucket per socket: refills `perSec` tokens a second, holds at most `burst`. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private perSec: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
