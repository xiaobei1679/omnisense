// workspace/.learnings/scripts/style-engine.mjs
//
// Neutral, zero-dependency "AI-isms / writing-quality" style guard for
// openclaw-workspace. This is the concrete module that qa-heuristic insights
// (produced by `make evolve`) point at: collected quality lessons get
// distilled into reusable rules here, gated by the Reviewer specialist
// (`scripts/ci/reviewer.mjs`) before they may land in the public repo.
//
// Why this exists: agent output that opens with "Great question!" or is padded
// with "值得注意的是 / 毋庸置疑" reads as low-effort AI text. This module lets
// an agent self-audit its prose deterministically — no LLM, no network, no
// dependencies. It is framework infrastructure, not project content.
//
// API (pure, importable):
//   analyze(text) -> { score, passed, issues[], counts }
//   RULES          -> the rule table (id / severity / message / suggestion)
//
// CLI:
//   node workspace/.learnings/scripts/style-engine.mjs [file]   # analyze a file
//   cat out.md | node workspace/.learnings/scripts/style-engine.mjs  # or stdin
//   -> prints a JSON report; exit 0 = passed, 1 = issues, 2 = usage error

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CJK = /[一-鿿]/g;

// Each rule is pure: (text) => snippet[] (array of matched fragments).
// severity: 'error' (auto-fail) | 'warn' (deduct score, may still pass).
export const RULES = [
  {
    id: 'greeting-filler',
    severity: 'error',
    message: '避免客套/讨好式开场（如"很高兴为你""Great question!"）',
    suggestion: '直接进入正题，用一句话结论开头。',
    match: (t) => {
      const head = t.slice(0, 60);
      const re =
        /^(很高兴为您|很高兴为你|当然可以|很荣幸|荣幸之至|您好！|你好，|hi!?,?|hello!?,?|great question!?|i'?d be happy to|sure,?!?|certainly!?|of course!?)/i;
      const m = head.match(re);
      return m ? [m[0]] : [];
    },
  },
  {
    id: 'ai-buzzword',
    severity: 'warn',
    message: '减少 AI 腔过渡词（值得注意的是/总而言之/不言而喻/毋庸置疑/综上所述）',
    suggestion: '直接陈述观点，删掉无信息量的连接词。',
    match: (t) => uniqueSnippets(t, /值得注意的是|总而言之|简单来说|不言而喻|毋庸置疑|无可否认|综上所述|究其原因|诚然|毋庸置疑/g),
  },
  {
    id: 'hollow-boast',
    severity: 'warn',
    message: '避免空泛夸张词（赋能/颠覆性/革命性/无与伦比/极致/一站式/闭环/抓手/组合拳）',
    suggestion: '用具体事实或数字代替形容词堆砌。',
    match: (t) => uniqueSnippets(t, /赋能|颠覆性|革命性|无与伦比|极致|一站式|闭环|抓手|组合拳|生态化|底层逻辑/g),
  },
  {
    id: 'long-sentence',
    severity: 'warn',
    message: '存在过长句子，可读性下降',
    suggestion: '把超过约 70 个汉字的句子拆成 2-3 句短句。',
    match: (t) => {
      const sents = t.split(/[。！？!?；;\n]/).map((s) => s.trim()).filter(Boolean);
      return sents
        .filter((s) => (s.match(CJK) || []).length > 70)
        .slice(0, 3)
        .map((s) => s.slice(0, 24) + '…');
    },
  },
  {
    id: 'passive-overuse',
    severity: 'warn',
    message: '被动句（"被…"）使用偏多',
    suggestion: '优先用主动语态，让主语靠前。',
    match: (t) => {
      const n = (t.match(/被/g) || []).length;
      return n > 3 ? [`被 ×${n}`] : [];
    },
  },
  {
    id: 'repeat-start',
    severity: 'warn',
    message: '相邻段落开头重复，节奏单调',
    suggestion: '变换每段开头，避免连续相同起句。',
    match: (t) => {
      const paras = t
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ''))
        .filter(Boolean);
      const hits = [];
      for (let i = 1; i < paras.length; i++) {
        const a = paras[i - 1].slice(0, 2);
        const b = paras[i].slice(0, 2);
        if (a && a === b && CJK.test(a)) hits.push(paras[i].slice(0, 12));
      }
      return hits.slice(0, 3);
    },
  },
];

function uniqueSnippets(text, re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
  }
  return [...new Set(out)];
}

const SCORE_DEDUCTION = { error: 25, warn: 10 };
const MAX_DEDUCTION = { error: 50, warn: 60 };

// Pure: analyze a piece of text, return a structured quality report.
//   score  : 0-100 (starts at 100, deductions capped per severity)
//   passed : score >= 60 AND no error-severity issues
//   issues : [{ rule, severity, message, snippet, suggestion }]
//   counts : { error, warn }
export function analyze(text) {
  const t = String(text || '');
  const issues = [];
  const counts = { error: 0, warn: 0 };
  for (const rule of RULES) {
    let hits = [];
    try {
      hits = rule.match(t);
    } catch {
      hits = [];
    }
    if (!hits || !hits.length) continue;
    for (const snippet of hits) {
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        snippet,
        suggestion: rule.suggestion,
      });
    }
    counts[rule.severity] += 1;
  }
  let score = 100;
  score -= Math.min(counts.error * SCORE_DEDUCTION.error, MAX_DEDUCTION.error);
  score -= Math.min(counts.warn * SCORE_DEDUCTION.warn, MAX_DEDUCTION.warn);
  score = Math.max(0, score);
  const passed = score >= 60 && counts.error === 0;
  return { score, passed, issues, counts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain =
  import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  let text = '';
  const fileArg = process.argv[2];
  if (fileArg) {
    try {
      text = readFileSync(resolve(fileArg), 'utf8');
    } catch (e) {
      console.error('cannot read', fileArg, '-', e.message);
      process.exit(2);
    }
  } else if (!process.stdin.isTTY) {
    try {
      text = readFileSync(0, 'utf8');
    } catch {
      text = '';
    }
  }
  const report = analyze(text);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.passed ? 0 : 1);
}
