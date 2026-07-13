// 结构化日志：分级 + 可静默，统一替换散落的 console.log。
// 用法：import { log } from './logger.mjs';  log.info('...'); log.warn('...');
// 级别（低→高）：trace < debug < info < warn < error < silent
// 控制：环境变量 OMNI_LOG_LEVEL=trace|debug|info|warn|error|silent；QUIET=1 等价于 error。
export const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, silent: 5 };

function _initialLevel() {
  const e = (process.env.OMNI_LOG_LEVEL || '').toLowerCase();
  if (e && e in LEVELS) return e;
  if (process.env.QUIET) return 'error';
  return 'info';
}

let _level = _initialLevel();

export function setLogLevel(l) {
  if (l && String(l).toLowerCase() in LEVELS) _level = String(l).toLowerCase();
}
export function getLogLevel() { return _level; }

function _fmt(args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function _emit(level, args) {
  if (LEVELS[level] < LEVELS[_level]) return;
  const line = _fmt(args);
  const tag = level === 'error' ? 'ERR ' : level === 'warn' ? 'WARN ' : level === 'debug' || level === 'trace' ? `${level.toUpperCase()} ` : '';
  const out = tag ? `${tag}${line}` : line;
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

export const log = {
  trace: (...a) => _emit('trace', a),
  debug: (...a) => _emit('debug', a),
  info:  (...a) => _emit('info', a),
  warn:  (...a) => _emit('warn', a),
  error: (...a) => _emit('error', a),
  setLevel: setLogLevel,
  get level() { return _level; },
};

export default log;
