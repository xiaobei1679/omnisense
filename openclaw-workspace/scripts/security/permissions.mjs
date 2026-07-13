// scripts/security/permissions.mjs
//
// Zero-dependency per-tool permission ladder: deny / ask / allow.
//
// Design basis (external research, see docs/research/2026-07-09-external-research.md):
// - AI Agent Security 2026 six-layer policy stack: "Permission is infrastructure,
//   not prompt" (https://slavadubrov.github.io/blog/2026/04/20/ai-agent-security/)
// - Claude Code Allow/Ask/Deny three-tier model + most-specific-match-wins
//   (https://docs.anthropic.com/en/docs/claude-code/safety/permission-model)
// - Default-deny grant table (Larry Peseckis, 2026-06) cross-walked to OWASP Top 10
//
// This module is the *runtime* tool-authorization layer. It is complementary to
// scripts/ci/observer.mjs (a static CI gate that scans diffs for secrets / paths).
// observer guards what gets committed; this guards what an agent may *call* at runtime.
// It encodes the repo's cardinal rules (never push, never force, never commit to main)
// as machine-checkable policy instead of a human-only convention.

import { pathToFileURL } from 'node:url';

// Ordered from most restrictive (0) to most permissive (2).
export const LEVELS = ['deny', 'ask', 'allow'];
const SEVERITY = { deny: 0, ask: 1, allow: 2 };

// Default ladder. `default` is the fallback for any tool with no matching rule.
// 'ask' = fail-closed-but-usable: unknown tools require explicit human confirmation
// rather than silently running. Operators extend `rules` for their own environment.
export const DEFAULT_LADDER = {
  default: 'ask',
  rules: [
    // Irreversible / escalation actions: hard deny (cardinal repo rules).
    { tool: 'git:push', level: 'deny', category: 'escalation', reason: 'Repository rule: never push to remote; a human reviews and pushes manually.' },
    { tool: 'git:push:force', level: 'deny', category: 'escalation', reason: 'Repository rule: never force-push.' },
    { tool: 'git:remote', level: 'ask', category: 'escalation', reason: 'Adding/removing remotes can move code off-box; confirm first.' },
    { tool: 'git:fetch', level: 'ask', category: 'network', reason: 'Network egress and can change local tracking refs.' },
    { tool: 'git:pull', level: 'ask', category: 'network', reason: 'Network egress and mutates the working tree.' },

    // Repo write scope: agents commit to a LOCAL review branch, never to main.
    { tool: 'repo:commit:main', level: 'deny', category: 'escalation', reason: 'Never commit straight to main; commit to a local review branch.' },
    { tool: 'repo:commit:local', level: 'allow', category: 'write', reason: 'Local-only commit to a review branch is the intended agent flow.' },

    // Secrets: never read or write them (observer also guards the files themselves).
    { tool: 'secret:read', level: 'deny', category: 'secret', reason: 'Reading credentials must never be automated.' },

    // Filesystem: reads are generally safe; writes need confirmation by default.
    { tool: 'fs:read', level: 'allow', category: 'read', reason: 'Reading files is needed and low-risk.' },
    { tool: 'fs:write', level: 'ask', category: 'write', reason: 'Any file write should be confirmed (observer also blocks protected paths).' },

    // Network egress and arbitrary shell: confirm before executing (least privilege).
    { tool: 'network:egress', level: 'ask', category: 'network', reason: 'Outbound calls can exfiltrate data; confirm first.' },
    { tool: 'shell:exec', level: 'ask', category: 'exec', reason: 'Arbitrary command execution needs human confirmation.' },
  ],
};

// Normalize a tool name into a stable ':'-segmented namespace.
// Spaces become separators; everything is lowercased and trimmed.
export function normalizeTool(tool) {
  if (typeof tool !== 'string') return '';
  const t = tool
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ':')
    .replace(/:{2,}/g, ':')
    .replace(/^:+|::+$/g, '');
  return t;
}

// Does a rule (prefix) match the requested tool?
// A rule 'git:push' matches 'git:push' exactly and 'git:push:force' as a prefix.
// The catch-all '*' matches everything (lowest specificity).
function ruleMatches(ruleTool, requested) {
  if (ruleTool === '*') return true;
  if (requested === ruleTool) return true;
  return requested.startsWith(ruleTool + ':');
}

// Resolve the single most-specific matching rule (ties broken by severity).
function findBestRule(requested, ladder) {
  const rules = (ladder && ladder.rules) || [];
  let best = null;
  let bestLen = -1;
  for (const rule of rules) {
    const rt = normalizeTool(rule.tool);
    if (!ruleMatches(rt, requested)) continue;
    const len = rt.length;
    if (len > bestLen) {
      bestLen = len;
      best = rule;
    } else if (len === bestLen && best && SEVERITY[rule.level] < SEVERITY[best.level]) {
      best = rule;
    }
  }
  return best;
}

// Return the permission level for a tool: 'deny' | 'ask' | 'allow'.
// Most-specific matching rule wins; ties resolved by severity (deny > ask > allow);
// no match falls back to ladder.default (itself 'ask' by default).
export function classifyTool(tool, ladder = DEFAULT_LADDER) {
  const requested = normalizeTool(tool);
  if (!requested) return (ladder && ladder.default) || 'ask';
  const best = findBestRule(requested, ladder);
  if (!best) return (ladder && ladder.default) || 'ask';
  return best.level;
}

// Convenience boolean: is this tool allowed without confirmation?
export function isAllowed(tool, ladder = DEFAULT_LADDER) {
  return classifyTool(tool, ladder) === 'allow';
}

// Structured policy resolution for one tool (mirrors resolveAgent style elsewhere).
export function resolvePolicy(tool, ladder = DEFAULT_LADDER) {
  const requested = normalizeTool(tool);
  const level = classifyTool(requested, ladder);
  const best = findBestRule(requested, ladder);
  return {
    tool: requested,
    level,
    category: best ? best.category : null,
    reason: best ? best.reason : null,
    matched: best ? best.tool : null,
    defaulted: best === null,
  };
}

// Return a shallow copy of the ladder's rules (for listing / inspection).
export function listRules(ladder = DEFAULT_LADDER) {
  return (ladder && ladder.rules ? ladder.rules : []).map((r) => ({ ...r }));
}

// ---- CLI ----
function printHelp() {
  console.log('Permission ladder — levels: deny > ask > allow (most specific match wins)');
  console.log(`default for unknown tools: ${DEFAULT_LADDER.default}`);
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/security/permissions.mjs --list        # print all rules');
  console.log('  node scripts/security/permissions.mjs --tool <name>  # resolve one tool');
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--list') || args.includes('-l')) {
    for (const r of DEFAULT_LADDER.rules) {
      const lvl = (r.level || '').padEnd(6);
      const name = (r.tool || '').padEnd(22);
      const cat = (r.category || '-').padEnd(12);
      console.log(`${lvl} ${name} [${cat}] ${r.reason || ''}`);
    }
    console.log(`default: ${DEFAULT_LADDER.default}`);
  } else if (args.includes('--tool')) {
    const idx = args.indexOf('--tool');
    const tool = args[idx + 1];
    if (!tool) {
      console.error('missing tool name after --tool');
      process.exit(2);
    }
    console.log(JSON.stringify(resolvePolicy(tool, DEFAULT_LADDER), null, 2));
  } else {
    printHelp();
  }
}
