// relations.mjs — 关系类型的规范集合，供「脑」判定因果链 / 做类比。
// 关键区分：CAUSAL（可用于因果链推理） vs RELATIONAL（真实关系但非因果，
// 用于关联/类比，不进入因果链）、COOCCUR（同句共现，弱关联，仅作旁证）。
export const CAUSAL = new Set([
  'causes', 'leads', 'enables', 'results', 'reveals',
  'prevents', 'blocks', 'stops', 'destroys', 'killed', 'hid', 'guards',
]);

// 否定形式（语言否定式矛盾检测用，如 "X did not cause Y" → not_causes）
export const NEG_CAUSAL = new Set(['not_causes', 'not_prevents']);

export const RELATIONAL = new Set([
  'discovered', 'found', 'warned', 'loved', 'saved', 'helped', 'sought',
  'feared', 'protected', 'betrayed', 'lost', 'entered', 'built', 'remembered',
  'became', 'contained', 'contains', 'told', 'asked', 'answered', 'met',
  'saw', 'knew', 'is', 'was', 'has', 'had', 'opened', 'closed',
]);

// 把各种动词形态归一到规范关系（含基础形式，提升召回：如 "cause/caused" 都归 "causes"）
const VERB_MAP = {
  cause: 'causes', causes: 'causes', caused: 'causes',
  lead: 'leads', leads: 'leads', led: 'leads',
  enable: 'enables', enables: 'enables', enabled: 'enables', enabling: 'enables',
  result: 'results', results: 'results', resulted: 'results',
  reveal: 'reveals', reveals: 'reveals', revealed: 'reveals',
  prevent: 'prevents', prevents: 'prevents', prevented: 'prevents',
  block: 'prevents', blocks: 'prevents', blocked: 'prevents',
  stop: 'prevents', stops: 'prevents', stopped: 'prevents',
  destroy: 'prevents', destroys: 'prevents', destroyed: 'prevents',
  kill: 'prevents', kills: 'prevents', killed: 'prevents',
  hide: 'prevents', hides: 'prevents', hid: 'prevents', guard: 'prevents', guards: 'prevents',
  discover: 'discovered', discovers: 'discovered', discovered: 'discovered', find: 'discovered', found: 'discovered', finds: 'discovered',
  warn: 'warned', warns: 'warned', warned: 'warned',
  love: 'loved', loves: 'loved', loved: 'loved',
  save: 'saved', saves: 'saved', saved: 'saved', help: 'helped', helps: 'helped', helped: 'helped',
  seek: 'sought', seeks: 'sought', sought: 'sought', fear: 'feared', fears: 'feared', feared: 'feared',
  protect: 'protected', protects: 'protected', protected: 'protected', betray: 'betrayed', betrays: 'betrayed', betrayed: 'betrayed',
  lose: 'lost', loses: 'lost', lost: 'lost', enter: 'entered', enters: 'entered', entered: 'entered',
  build: 'built', builds: 'built', built: 'built', remember: 'remembered', remembers: 'remembered', remembered: 'remembered',
  become: 'became', becomes: 'became', became: 'became', contain: 'contains', contains: 'contains', contained: 'contained',
  tell: 'told', tells: 'told', told: 'told', ask: 'asked', asks: 'asked', asked: 'asked',
  answer: 'answered', answers: 'answered', answered: 'answered',
  meet: 'met', meets: 'met', met: 'met', see: 'met', sees: 'met', saw: 'met',
  know: 'knew', knows: 'knew', knew: 'knew',
  is: 'is', was: 'was', are: 'are', were: 'were', has: 'has', have: 'has', had: 'had',
  open: 'opened', opens: 'opened', opened: 'opened', close: 'closed', closes: 'closed', closed: 'closed',
};

export const VERB_FORMS = Object.keys(VERB_MAP).sort((a, b) => b.length - a.length);

export function canonRelation(verb) {
  if (!verb || typeof verb !== 'string') return null;
  return VERB_MAP[verb.toLowerCase()] || null;
}

export function relationKind(rel) {
  if (CAUSAL.has(rel) || NEG_CAUSAL.has(rel)) return 'causal';
  if (RELATIONAL.has(rel)) return 'relational';
  return 'other';
}

// 仅正向因果边进入因果链/演绎（否定边不计入因果传递，仅用于矛盾检测）
export const IS_CAUSAL = CAUSAL;
