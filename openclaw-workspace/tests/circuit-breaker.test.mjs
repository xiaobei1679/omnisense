// tests/circuit-breaker.test.mjs — tests for scripts/llm/circuit-breaker.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker, withBreaker, CircuitOpenError, STATE } from '../scripts/llm/circuit-breaker.mjs';

// Mutable injectable clock.
function clock() {
  const c = { t: 0 };
  return { now: () => c.t, advance: (ms) => (c.t += ms) };
}

// In-memory fs shim for offline persistence tests (atomic temp+rename modeled).
function memFs() {
  const store = new Map();
  return {
    store,
    readFileSync: (p) => {
      if (!store.has(p)) throw new Error('ENOENT');
      return store.get(p);
    },
    writeFileSync: (p, d) => {
      store.set(p, String(d));
    },
    existsSync: (p) => store.has(p),
    mkdirSync: () => {},
    renameSync: (o, n) => {
      const d = store.get(o);
      store.set(n, d);
      store.delete(o);
    },
  };
}

test('starts CLOSED and stays CLOSED on success', async () => {
  const b = createBreaker({ now: clock().now });
  assert.equal(b.state, STATE.CLOSED);
  assert.equal(await b.exec(async () => 'ok'), 'ok');
  assert.equal(b.state, STATE.CLOSED);
});

test('trips OPEN after failureThreshold consecutive failures', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 2, cooldownMs: 100, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  assert.equal(b.state, STATE.OPEN);
});

test('while OPEN and before cooldown, exec throws CircuitOpenError without calling fn', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  let called = 0;
  await assert.rejects(() => b.exec(async () => { called++; throw new Error('x'); }), CircuitOpenError);
  assert.equal(called, 0);
  assert.equal(b.state, STATE.OPEN);
});

test('after cooldown, probes in HALF_OPEN and closes after successThreshold successes', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 2, cooldownMs: 100, successThreshold: 2, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  assert.equal(b.state, STATE.OPEN);
  c.advance(200); // past cooldown
  assert.equal(await b.exec(async () => 'a'), 'a');
  assert.equal(b.state, STATE.HALF_OPEN);
  assert.equal(await b.exec(async () => 'b'), 'b');
  assert.equal(b.state, STATE.CLOSED);
});

test('a failure in HALF_OPEN re-opens the breaker', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 1, cooldownMs: 100, successThreshold: 2, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  c.advance(200);
  assert.equal(await b.exec(async () => 'a'), 'a'); // half-open probe ok
  assert.equal(b.state, STATE.HALF_OPEN);
  await assert.rejects(() => b.exec(async () => { throw new Error('y'); }));
  assert.equal(b.state, STATE.OPEN);
});

test('a success in CLOSED heals accumulated failures', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 3, cooldownMs: 100, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  assert.equal(b.failures, 2);
  assert.equal(await b.exec(async () => 'ok'), 'ok');
  assert.equal(b.failures, 0);
  assert.equal(b.state, STATE.CLOSED);
});

test('withBreaker routes calls through the breaker', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c.now });
  const ok = withBreaker(b, (x) => x * 2);
  assert.equal(await ok(21), 42);
  assert.equal(b.state, STATE.CLOSED);
  const bad = withBreaker(b, () => {
    throw new Error('boom');
  });
  await assert.rejects(() => bad(1)); // throws -> trips open
  assert.equal(b.state, STATE.OPEN);
});

// ---------------------------------------------------------------------------
// Persistence (opt-in via persistPath): the breaker must reload its OPEN state
// from disk in a NEW process run, so it actually protects across the
// one-process-per-call run model. Uses the in-memory fs shim — fully offline.
// ---------------------------------------------------------------------------

test('persists OPEN state to disk and reloads it in a new breaker (cross-run)', async () => {
  const fs = memFs();
  const path = '/tmp/cb-state.json';
  const c = clock();
  const b1 = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c.now, persistPath: path, fs });
  await assert.rejects(() => b1.exec(async () => { throw new Error('x'); }));
  assert.equal(b1.state, STATE.OPEN);
  // a file was written
  assert.ok(fs.existsSync(path), 'persisted state file should exist');
  const saved = JSON.parse(fs.readFileSync(path));
  assert.equal(saved.state, STATE.OPEN);
  assert.ok(typeof saved.openedAt === 'number');

  // New breaker (simulating a separate process run) loads the OPEN state.
  const c2 = clock(); // fresh clock starting at 0
  const b2 = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c2.now, persistPath: path, fs });
  assert.equal(b2.state, STATE.OPEN, 'reloaded breaker should start OPEN');
  // before cooldown elapses, a probe must NOT be allowed (stays OPEN, fast-fail).
  let called = 0;
  await assert.rejects(() => b2.exec(async () => { called++; return 'ok'; }), CircuitOpenError);
  assert.equal(called, 0);

  // advance past cooldown: probe allowed. Needs successThreshold (default 2)
  // consecutive successes to fully CLOSE; the first probe only reaches HALF_OPEN.
  c2.advance(200);
  assert.equal(await b2.exec(async () => 'ok'), 'ok');
  assert.equal(b2.state, STATE.HALF_OPEN);
  assert.equal(await b2.exec(async () => 'ok'), 'ok');
  assert.equal(b2.state, STATE.CLOSED);
  const saved2 = JSON.parse(fs.readFileSync(path));
  assert.equal(saved2.state, STATE.CLOSED);
});

test('broken/corrupt persisted file is ignored (starts CLOSED)', async () => {
  const fs = memFs();
  const path = '/tmp/cb-corrupt.json';
  fs.writeFileSync(path, '{not valid json');
  const b = createBreaker({ persistPath: path, fs });
  assert.equal(b.state, STATE.CLOSED, 'corrupt save must not break the breaker');
});

test('persistence is opt-in: without persistPath the breaker is in-memory only', async () => {
  const c = clock();
  const b = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c.now });
  await assert.rejects(() => b.exec(async () => { throw new Error('x'); }));
  assert.equal(b.state, STATE.OPEN);
  // No persistPath -> no file touched; a brand-new in-memory breaker (no path)
  // starts fresh CLOSED, proving nothing was shared/saved.
  const b2 = createBreaker({ failureThreshold: 1, cooldownMs: 100, now: c.now });
  assert.equal(b2.state, STATE.CLOSED);
});
