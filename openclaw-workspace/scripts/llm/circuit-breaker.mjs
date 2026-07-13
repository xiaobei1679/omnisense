// scripts/llm/circuit-breaker.mjs
//
// Zero-dependency Circuit Breaker for resilient LLM / tool calls.
//
// Design basis (external GitHub / web research, 2026-07-09 round 2):
// - Circuit breaking is a standard resilience pattern. rheatkhs/yves-circuit-breaker
//   is explicitly "zero-dependency, framework-agnostic, pure-logic"; ayushedith/
//   retryify bundles retry/backoff/timeout/circuit-breaker/in-flight-dedup.
//   Articles (dev.to wallacefreitas, young_gao) describe the CLOSED/OPEN/
//   HALF_OPEN state machine with a failure threshold and cooldown recovery.
// - This module is pure logic: an injectable `now` clock makes it fully
//   offline-testable. It complements the existing transient-error RETRY in
//   respond.mjs — retry handles a single blip; the breaker stops the same
//   failing provider from being hammered repeatedly (thundering herd).
//
// 2026-07-10: state PERSISTENCE (opt-in via `persistPath`). The default run
// model is "one process = one LLM call": the in-memory breaker would lose its
// state on exit and never matter across runs. When `persistPath` is set the
// breaker reloads its state on construction and rewrites it on every
// transition (atomic temp+rename), so it actually protects across separate
// process runs. When `persistPath` is unset the breaker is purely in-memory
// and touches no disk (preserving offline-testability and test hermeticity).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' };

export class CircuitOpenError extends Error {
  constructor(message = 'circuit breaker is open') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// Create a circuit breaker.
//   opts.failureThreshold (default 3): consecutive failures in CLOSED that trip OPEN
//   opts.cooldownMs       (default 5000): how long to stay OPEN before probing
//   opts.successThreshold (default 2): consecutive successes in HALF_OPEN that close it
//   opts.now              (default Date.now): injectable clock for deterministic tests
//   opts.persistPath      (default null): if set, reload/rewrite breaker state to
//     this file (temp+rename atomic write) so it survives separate process runs —
//     required for the breaker to matter under the one-process-per-call model.
//   opts.fs               (default node:fs): injectable fs for offline tests.
export function createBreaker(opts = {}) {
  const failureThreshold = Number(opts.failureThreshold ?? 3);
  const cooldownMs = Number(opts.cooldownMs ?? 5000);
  const successThreshold = Number(opts.successThreshold ?? 2);
  const now = opts.now || Date.now;
  // Persistence (opt-in). Injected `opts.fs` keeps the CLI / tests fully
  // offline; when `persistPath` is unset the breaker is purely in-memory.
  const fsImpl = opts.fs || { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync };
  const persistPath = opts.persistPath || null;

  let state = STATE.CLOSED;
  let failures = 0;
  let consecutiveSuccesses = 0;
  let openedAt = 0;

  function snapshot() {
    return { state, failures, consecutiveSuccesses, openedAt };
  }

  // Atomic write of the endpoint-health signal (state + openedAt). Non-fatal:
  // a persist failure must never break the breaker.
  function persist() {
    if (!persistPath) return;
    try {
      const dir = dirname(persistPath);
      if (dir && dir !== '.') fsImpl.mkdirSync(dir, { recursive: true });
      const json = JSON.stringify({ state, openedAt, savedAt: now() });
      const tmp = `${persistPath}.tmp`;
      fsImpl.writeFileSync(tmp, json, 'utf8');
      fsImpl.renameSync(tmp, persistPath);
    } catch {
      /* persistence must never break the breaker */
    }
  }

  // Reload a previously saved state. ONLY the endpoint-health signal (OPEN +
  // cooldown) survives a reload; per-run counters reset so an independent task
  // doesn't inherit a half-tripped threshold from a previous process. A
  // corrupt/invalid save is ignored and we simply start CLOSED.
  function loadPersisted() {
    if (!persistPath) return;
    try {
      if (fsImpl.existsSync(persistPath)) {
        const parsed = JSON.parse(fsImpl.readFileSync(persistPath, 'utf8'));
        if (parsed && typeof parsed.state === 'string' && Object.values(STATE).includes(parsed.state)) {
          state = parsed.state;
          openedAt = Number(parsed.openedAt || 0);
          failures = 0;
          consecutiveSuccesses = 0;
        }
      }
    } catch {
      /* ignore corrupt save -> start CLOSED */
    }
  }

  // Restore any persisted state before the breaker is used.
  loadPersisted();

  async function exec(fn) {
    if (state === STATE.OPEN) {
      if (now() - openedAt >= cooldownMs) {
        // cooldown elapsed: probe in half-open
        state = STATE.HALF_OPEN;
        consecutiveSuccesses = 0;
        persist();
      } else {
        throw new CircuitOpenError();
      }
    }
    try {
      const result = await fn();
      // success path
      if (state === STATE.HALF_OPEN) {
        consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= successThreshold) {
          state = STATE.CLOSED;
          failures = 0;
          consecutiveSuccesses = 0;
          persist();
        }
      } else if (state === STATE.CLOSED) {
        // a success heals accumulated failures
        failures = 0;
      }
      return result;
    } catch (err) {
      // failure path
      if (state === STATE.HALF_OPEN) {
        state = STATE.OPEN;
        openedAt = now();
        consecutiveSuccesses = 0;
        persist();
      } else if (state === STATE.CLOSED) {
        failures += 1;
        if (failures >= failureThreshold) {
          state = STATE.OPEN;
          openedAt = now();
          persist();
        }
      }
      throw err;
    }
  }

  return {
    exec,
    get state() {
      return state;
    },
    get failures() {
      return failures;
    },
    snapshot,
    reset() {
      state = STATE.CLOSED;
      failures = 0;
      consecutiveSuccesses = 0;
      openedAt = 0;
      persist();
    },
  };
}

// Read a persisted breaker state file. Returns the parsed object or null.
// Never throws. Convenience for tooling / CLI / tests (avoids re-implementing
// the parse + the STATE validity check). `fsImpl` is injectable for offline use.
export function loadBreakerState(path, fsImpl) {
  const fs = fsImpl || { readFileSync, existsSync };
  try {
    if (fs.existsSync(path)) {
      const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Convenience: wrap fn so every call goes through the breaker.
// Returns (...args) => breaker.exec(() => fn(...args)).
export function withBreaker(breaker, fn) {
  return (...args) => breaker.exec(() => fn(...args));
}

// ---- CLI ----
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
function printHelp() {
  console.log('Circuit breaker (CLOSED/OPEN/HALF_OPEN state machine; zero dependency).');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/llm/circuit-breaker.mjs --demo   # walk the state machine (no real waits)');
}

if (isMain) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.includes('--demo')) {
      let t = 0;
      const clock = () => t;
      const b = createBreaker({ failureThreshold: 2, cooldownMs: 100, successThreshold: 2, now: clock });
      const fail = () => {
        throw new Error('boom');
      };
      const ok = () => 'ok';
      const log = [];
      log.push(`initial: ${b.state}`);
      // 2 consecutive failures -> OPEN
      for (let i = 0; i < 2; i++) {
        try {
          await b.exec(fail);
        } catch {
          /* expected */
        }
      }
      log.push(`after 2 failures: ${b.state}`);
      // still OPEN before cooldown: fn not called, throws CircuitOpenError
      let called = 0;
      try {
        await b.exec(() => {
          called++;
          throw new Error('x');
        });
      } catch (e) {
        log.push(`before cooldown, error=${e.name}, fnCalled=${called}`);
      }
      // advance past cooldown -> next exec probes (HALF_OPEN)
      t = 200;
      try {
        await b.exec(ok);
      } catch {
        /* not expected */
      }
      log.push(`after cooldown + 1 success: ${b.state}`);
      // 2nd success -> CLOSED
      try {
        await b.exec(ok);
      } catch {
        /* not expected */
      }
      log.push(`after 2nd success: ${b.state}`);
      // failures re-accumulate in CLOSED; 2 trips OPEN again
      try {
        await b.exec(fail);
      } catch {
        /* expected */
      }
      log.push(`after 1 failure in closed: ${b.state} (failures=${b.failures})`);
      try {
        await b.exec(fail);
      } catch {
        /* expected */
      }
      log.push(`after 2 failures in closed: ${b.state} (failures=${b.failures})`);
      console.log(log.join('\n'));
    } else {
      printHelp();
    }
  })();
}
