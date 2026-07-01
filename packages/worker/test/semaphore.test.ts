import { describe, it, expect } from "vitest";
import { Semaphore, withPermit } from "../src/semaphore.js";

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("Semaphore", () => {
  it("never lets more than `permits` run concurrently under a burst", async () => {
    const sem = new Semaphore(3);
    let live = 0;
    let peak = 0;
    const task = (): Promise<void> =>
      withPermit(sem, async () => {
        live++;
        peak = Math.max(peak, live);
        await tick(5);
        live--;
      });

    await Promise.all(Array.from({ length: 12 }, task));

    expect(peak).toBe(3);
    expect(live).toBe(0);
  });

  it("admits waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    // task 1 acquires synchronously (permits 1→0); 2 and 3 then queue behind it.
    const t1 = withPermit(sem, async () => {
      order.push(1);
      await tick(5);
    });
    const t2 = withPermit(sem, async () => {
      order.push(2);
    });
    const t3 = withPermit(sem, async () => {
      order.push(3);
    });

    await Promise.all([t1, t2, t3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("releases the permit even when fn throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      withPermit(sem, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The permit must have been returned: a subsequent acquire resolves.
    let ran = false;
    await withPermit(sem, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
