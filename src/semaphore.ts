// A tiny counting semaphore for bounding concurrent async work. The Kroger
// client uses it to cap in-flight HTTP requests, so a caller that fans out many
// lookups (e.g. kroger_flyer across dozens of terms via Promise.all) cannot
// burst the upstream into rate-limiting.
//
// This is the single-threaded async analog of an OS semaphore: `permits` is a
// counter and `waiters` a FIFO queue of pending resolvers. Acquiring with no
// free permit returns a promise that resolves only when a later release hands a
// permit over — "waiting" is just an unresolved await, not a blocked thread.

export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, Math.floor(permits));
  }

  /** Take a permit, or wait (FIFO) until one is released. */
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Return a permit — handing it straight to the oldest waiter if one is queued. */
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }
}

/** Run `fn` while holding one permit; the permit is ALWAYS released, even on throw. */
export async function withPermit<T>(sem: Semaphore, fn: () => Promise<T>): Promise<T> {
  await sem.acquire();
  try {
    return await fn();
  } finally {
    sem.release();
  }
}
