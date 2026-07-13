import test from 'node:test';
import assert from 'node:assert/strict';
import { log, setLogLevel, getLogLevel } from '../src/core/logger.mjs';

test('日志级别过滤：低级别被抑制', () => {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const out = [], err = [];
  process.stdout.write = (s) => { out.push(s); return true; };
  process.stderr.write = (s) => { err.push(s); return true; };
  try {
    setLogLevel('warn');
    log.info('should-be-silent');
    log.debug('also-silent');
    log.warn('visible-warn');
    log.error('visible-error');
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  const outJoined = out.join('');
  const errJoined = err.join('');
  assert.ok(!outJoined.includes('should-be-silent'), 'info 应被抑制(stdout)');
  assert.ok(!outJoined.includes('also-silent'), 'debug 应被抑制(stdout)');
  assert.ok(outJoined.includes('visible-warn'), 'warn 应出现(stdout)');
  assert.ok(errJoined.includes('visible-error'), 'error 应出现(stderr)');
});

test('日志级别可切换与读取', () => {
  setLogLevel('error');
  assert.equal(getLogLevel(), 'error');
  setLogLevel('info'); // 还原
  assert.equal(getLogLevel(), 'info');
});
