// nlp.mjs — 零依赖轻量文本理解（真实本地 NLP，无 API、无外部模型）。
// 用于「眼/耳」从文本里抽取实体与关系三元组、识别主题。
import { VERB_FORMS, canonRelation, relationKind } from './relations.mjs';

const STOP = new Set([
  'The', 'And', 'But', 'For', 'She', 'He', 'Her', 'His', 'Was', 'Were', 'With', 'From', 'That', 'This',
  'They', 'Them', 'When', 'Where', 'What', 'Who', 'Into', 'Upon', 'After', 'Before', 'Could', 'Would',
  'Should', 'Every', 'Told', 'Said', 'Felt', 'Made', 'Came', 'Went', 'Seen', 'Give', 'Took',
  'Need', 'Great', 'Then', 'There', 'Their', 'Able', 'Even', 'Also', 'One', 'Two', 'Many', 'Some', 'Such',
  'Like', 'More', 'Most', 'Very', 'Just', 'Now', 'Still', 'Both', 'Each', 'Much', 'These', 'Those', 'Will',
  'Been', 'Being', 'Have', 'Has', 'Had', 'Does', 'Did', 'Not', 'No', 'Yes', 'Than', 'Too', 'Out', 'Off',
  'About', 'Over', 'Down', 'Up', 'While', 'Because', 'Although', 'Though', 'Until', 'Between', 'Through',
  'During', 'Without', 'Within', 'Among', 'Against', 'Toward', 'Across', 'Behind', 'Beneath',
  // 否定/助动词（避免被当成主语或关系动词）
  'not', 'never', 'without', 'did', 'does', 'do', 'nt',
  // 常见书名/章节/版式噪声
  'Chapter', 'Contents', 'Project', 'Gutenberg', 'Australia', 'BROWSE', 'HELP', 'Reading', 'Downloading',
  'Converting', 'SEARCH', 'Google', 'Site', 'Search', 'Jane', 'Austen', 'CONTENTS', 'However', 'Netherfield',
  'Park', 'Mrs', 'Long', 'Bennet', 'Mr', 'Dear', 'Pride', 'Prejudice',
  // 虚代词/指示词/抽象名词（避免 "It 是 truth" 这类弱主语句）
  'It', 'Its', 'So', 'Thus', 'Hence', 'There', 'Here', 'Truth', 'Reality',
]);

export function tokenizeSentences(text) {
  return (text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [text || ''];
}

export function extractEntities(text) {
  const toks = text.match(/[A-Z][a-zA-Z]{2,}/g) || [];
  const set = new Set();
  for (const t of toks) if (!STOP.has(t)) set.add(t);
  return [...set];
}

// 真实关系抽取：句子里出现「[主语] [真实关系动词] [宾语]」时成边。
// 主语允许小写普通名词（不再强制专有名词大写）—— 修复此前"小写主语整句丢三元组"的召回缺陷；
// 用 STOP 过滤噪声词、用真实关系动词约束，避免把书名相邻词当关系。
// 同时检测否定（did not / never / n't → not_<canon>）与粗粒度时态（诚实标注，非精确）。
const VERB_ALT = VERB_FORMS.join('|');
const TRIPLE_RE = new RegExp(
  `(?:The\\s+)?([A-Za-z][a-zA-Z]+)(?:'s)?\\s+(?:(?:did|does|do)\\s+)?(?:not\\s+|never\\s+)?(${VERB_ALT})\\s+(?:the\\s+|an\\s+|a\\s+)?([A-Za-z][a-zA-Z]{2,})`,
  'i'
);
const NEG_RE = /\b(not|never|n't|did\s+not|did\s+n't|without)\b/i;
const PAST_RE = /(ed|led)$/i;

export function extractTriples(text) {
  const triples = [];
  for (const s of tokenizeSentences(text)) {
    const m = s.match(TRIPLE_RE);
    if (!m) continue;
    const subj = m[1], verb = m[2].toLowerCase(), objRaw = m[3];
    const obj = objRaw.replace(/^the\s+/i, '');
    if (STOP.has(subj) || STOP.has(obj)) continue;
    const canon = canonRelation(verb);
    if (!canon) continue; // 不是真实关系动词 → 不成边
    // 否定检测：动词前的从句里出现否定词 → 关系取反（用于矛盾检测）
    const verbStart = s.toLowerCase().indexOf(verb, m.index);
    const negated = NEG_RE.test(s.slice(0, verbStart < 0 ? m.index : verbStart));
    const rel = negated ? `not_${canon}` : canon;
    const tense = PAST_RE.test(verb) ? 'past' : 'present';
    triples.push({ subj, rel, obj, kind: relationKind(rel), tense, negated });
  }
  // 去重（含否定标记）
  const seen = new Set();
  return triples.filter((t) => {
    const k = `${t.subj}|${t.rel}|${t.obj}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const THEME_LEXICON = {
  '记忆': ['remembered', 'memory', 'recall', 'name', 'forgot'],
  '爱': ['love', 'loves', 'beloved', 'affection'],
  '死亡': ['death', 'died', 'dead', 'kill', 'killed'],
  '权力': ['power', 'throne', 'rule', 'king', 'queen', 'control'],
  '身份': ['identity', 'secret', 'disguise'],
  '复仇': ['revenge', 'vengeance', 'betray', 'betrayed'],
  '转变': ['transform', 'changed', 'became', 'metamorphosis'],
  '恐惧': ['feared', 'fear', 'dread', 'terror', 'haunt', 'curse'],
};

export function detectThemes(text) {
  const t = (text || '').toLowerCase();
  const out = [];
  for (const [theme, kw] of Object.entries(THEME_LEXICON)) {
    if (kw.some((k) => t.includes(k))) out.push(theme);
  }
  return out;
}
