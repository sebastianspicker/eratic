// Test helpers only; nothing in the app imports this file.
import type { Clock } from "./clock";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class FakeClock implements Clock {
  time = 0;
  private timers: { at: number; resolve: () => void }[] = [];
  now() {
    return this.time;
  }
  sleep(ms: number) {
    return new Promise<void>((resolve) => {
      this.timers.push({ at: this.time + ms, resolve });
    });
  }
  // Moves time forward, firing due timers in order and letting promises settle.
  async advance(ms: number) {
    const target = this.time + ms;
    await flush();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.time = Math.max(this.time, next.at);
      next.resolve();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
