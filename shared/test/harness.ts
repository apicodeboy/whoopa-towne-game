/** Tiny zero-dependency test harness. */
type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function approx(actual: number, expected: number, tol: number, msg: string): void {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg}: expected ${expected} ±${tol}, got ${actual}`);
  }
}

export async function runAll(filter?: string): Promise<void> {
  let passed = 0;
  const failed: string[] = [];
  const t0 = performance.now();
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    try {
      await t.fn();
      passed++;
      console.log(`  ok   ${t.name}`);
    } catch (err) {
      failed.push(t.name);
      console.log(`  FAIL ${t.name}\n       ${(err as Error).message}`);
    }
  }
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n${passed} passed, ${failed.length} failed (${ms} ms)`);
  if (failed.length) process.exit(1);
}
