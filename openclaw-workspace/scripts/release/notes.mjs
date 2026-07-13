// scripts/release/notes.mjs
//
// Zero-dependency **release-notes generator** for the openclaw-workspace
// public template. It parses the framework changelog
// (`docs/CHANGELOG.md`, the "openclaw-workspace 公开框架" section) and
// emits clean Markdown release notes for a GitHub Release.
//
// This is the "release" half of ROADMAP's Later item, wired into
// `.github/workflows/release.yml`: when a HUMAN pushes a semantic tag
// (e.g. v1.0.0) or runs the workflow manually, the workflow runs the
// repo healthcheck, generates `release-notes.md`, then creates the GitHub
// Release via `softprops/action-gh-release` using the AUTO-INJECTED
// GITHUB_TOKEN (no user credentials). The local hourly automation never
// pushes a tag, so it can never trigger this workflow.
//
// API (pure, importable for tests):
//   findPublicSection(text)        -> string | null
//   parseEntries(section)         -> [{ date, title, body }]
//   cleanTitle(raw)               -> string
//   extractEntries(text, opts)    -> [{ date, title, body }]
//   formatReleaseNotes(entries, o)-> string
//   buildRelease(text, opts)      -> { version, date, entries, notes }
//
// CLI:
//   node scripts/release/notes.mjs [--changelog <path>] [--version <v>]
//                              [--date <YYYY-MM-DD>] [--count N]
//                              [--since YYYY-MM-DD] [--out <file>] [--json]
//
// NOTE: the framework changelog lives at docs/CHANGELOG.md (not repo root).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Match the public-framework changelog section header.
const PUBLIC_SECTION_RE = /^##\s+openclaw-workspace\s+公开框架/;
// Match an "### YYYY-MM-DD（title）" entry heading.
const ENTRY_RE = /^###\s+(\d{4}-\d{2}-\d{2})/;

// Extract the public-framework changelog section: from the
// "## openclaw-workspace 公开框架（…）" heading up to the next "## "
// heading (the internal project-turnover section, which must NOT leak
// into public release notes).
export function findPublicSection(text) {
  const lines = String(text || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (PUBLIC_SECTION_RE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break; // next top-level section ends ours
    out.push(lines[i]);
  }
  return out.join('\n');
}

// Strip the internal automation marker ("· 本地，未推送" / "· 本地") and
// the surrounding parentheses so release titles read cleanly for end users.
export function cleanTitle(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/[（(]([^（）)]*)[）)]/);
  let t = m ? m[1] : s;
  t = t
    .replace(/[·•]\s*本地[，, ]*未推送.*$/i, '')
    .replace(/[·•]\s*本地\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || s;
}

// Parse each "### YYYY-MM-DD（title）" entry under a section into a
// structured list, preserving source order (top = most recent).
export function parseEntries(section) {
  if (!section) return [];
  const lines = section.split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(ENTRY_RE);
    if (m) {
      if (cur) entries.push(cur);
      const title = cleanTitle(line.replace(ENTRY_RE, '').trim());
      cur = { date: m[1], title, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) entries.push(cur);
  return entries.map((e) => ({
    date: e.date,
    title: e.title,
    body: e.body.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }));
}

// Top-level extraction with optional filters:
//   since: include only entries with date >= since (string compare works for
//          ISO dates)
//   count: keep only the top N entries
export function extractEntries(text, { count, since } = {}) {
  const section = findPublicSection(text);
  let entries = parseEntries(section);
  if (since) {
    entries = entries.filter((e) => e.date >= since);
  }
  if (count && count > 0) {
    entries = entries.slice(0, count);
  }
  return entries;
}

// Render deterministic Markdown release notes.
export function formatReleaseNotes(entries, { version = 'unreleased', date } = {}) {
  const v = String(version || 'unreleased').trim();
  const d = date ? String(date) : entries[0] ? entries[0].date : '';
  const head = [`# Release ${v}` + (d ? ` (${d})` : ''), ''];
  head.push('_Auto-generated from CHANGELOG.md — openclaw-workspace public framework._', '');
  if (!entries.length) {
    head.push('No framework changelog entries found.');
    return head.join('\n');
  }
  const blocks = entries.map((e) => {
    const titleLine = `## ${e.title || e.date}` + (e.date ? ` (${e.date})` : '');
    const content = e.body ? `\n${e.body}\n` : '';
    return titleLine + content;
  });
  return head.join('\n') + blocks.join('\n') + '\n';
}

// Orchestrate: parse + filter + format into one result object.
export function buildRelease(text, opts = {}) {
  const entries = extractEntries(text, opts);
  const notes = formatReleaseNotes(entries, opts);
  return {
    version: opts.version || 'unreleased',
    date: opts.date || (entries[0] ? entries[0].date : ''),
    entries,
    notes,
  };
}

// --- CLI --------------------------------------------------------------------
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);
  let changelog = 'docs/CHANGELOG.md';
  let version = process.env.npm_package_version || 'unreleased';
  let date;
  let count;
  let since;
  let out;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') asJson = true;
    else if (a === '--changelog') changelog = args[++i] || changelog;
    else if (a === '--version') version = args[++i] || version;
    else if (a === '--date') date = args[++i] || date;
    else if (a === '--count') count = parseInt(args[++i], 10);
    else if (a === '--since') since = args[++i] || since;
    else if (a === '--out') out = args[++i] || out;
  }
  let text;
  try {
    text = readFileSync(resolve(changelog), 'utf8');
  } catch (e) {
    console.error(`cannot read changelog: ${changelog} (${e.message})`);
    process.exit(1);
  }
  const result = buildRelease(text, { version, date, count, since });
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }
  if (out) {
    try {
      writeFileSync(resolve(out), result.notes, 'utf8');
      console.log(`Release notes written to ${out} (${result.entries.length} entries)`);
    } catch (e) {
      console.error(`failed to write: ${e.message}`);
      process.exit(1);
    }
  } else {
    process.stdout.write(result.notes);
  }
}
