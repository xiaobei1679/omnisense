// 学习者（学渊引擎）—— 零 API：去网上/本地克隆公开项目，蒸馏「怎么真正去看/听/思/说」的技法。
// 诚实说明：蒸馏 = 读取项目 README/SKILL/文档里的技术表述并结构化，不是运行其 ML 模型。
//
// 学习来源优先级（让心跳在任何环境都能真学到东西）：
//   1) 预置成果：.learn_cache/<name>.learning.json 已由外部（agent 用 Web 搜索）注入 → 直接消费，不重复克隆
//   2) git clone：真·去网上克隆公开仓库（用户真机/有网时生效；沙箱白名单限制下会失败）
//   3) 本地回退：读取本地已存在的项目目录（如已安装的 skill、本地框架仓库）→ 真·读真·蒸馏
//   4) 都失败 → 抛错，由心跳优雅降级（不阻断主闭环）
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const CACHE = '.learn_cache';
const HOME = homedir();

// 策展：四个能力 → 可公开克隆的开源项目（无 API Key）。真实部署时心跳会真去 clone。
export const CURATED = [
  { topic: '真正去阅读/蒸馏文本知识（眼）', repo: 'https://github.com/kangarooking/cangjie-skill', mapsTo: 'see' },
  { topic: '真正去聆听/解析转录文本（耳）', repo: 'https://github.com/NaturalNode/natural', mapsTo: 'listen' },
  { topic: '真正去思考/知识图谱符号推理（脑）', repo: 'https://github.com/thunlp/OpenKE', mapsTo: 'think' },
  { topic: '真正去交流/对话系统设计（嘴）', repo: 'https://github.com/kangarooking/cangjie-skill', mapsTo: 'talk' },
  // 本轮常驻迭代（monitor 多舰队差异化阈值）的诚实延伸：身体从自身监控器官蒸馏 observability 模式，
  // 让"学习子系统"也能离线消费 OmniSense 的监控最佳实践（含多 fleet 差异化阈值/红黄绿着色/Alertmanager 告警）。
  // 读 OmniSense 仓库根的 README/SKILL（已在 monitor 章节记录上述能力），无需联网即可真蒸馏。
  { topic: '可观测性 / 多舰队差异化监控（身体从自身监控器官蒸馏 observability 模式）', repo: 'omnisense-monitor', localDir: resolve(process.env.ZW_OMNI_DIR || join(HOME, 'Desktop', 'OmniSense')), mapsTo: 'observe' },
];

// 本地回退源：沙箱网络受限时的真实学习材料（都是本地已存在的真实项目，可读可蒸馏）。
// 路径可经环境变量 ZW_LOCAL_DIR 覆盖，避免硬编码导致他机"静默失败"。
const LOCAL_DIR = process.env.ZW_LOCAL_DIR
  || join(HOME, 'Desktop', 'QClaw-GitHub-Repo_20260708');
export const LOCAL_FALLBACK = [
  {
    topic: '多智能体框架本身的感知-推理-行动架构（脑/嘴/系统）',
    name: 'openclaw-workspace',
    dir: resolve(LOCAL_DIR),
    mapsTo: 'think',
  },
  {
    topic: '用 RIA-TV++ 方法真正去蒸馏文本知识（眼/学）',
    name: 'cangjie-skill',
    dir: join(HOME, '.workbuddy/skills/cangjie-skill'),
    mapsTo: 'see',
  },
];

// 可扩展学习源：若同目录存在 sources.json（[{topic,repo,mapsTo}]），并入候选队列。
// 这让"持续成长"变为诚实可扩展——新增学习源只需往 sources.json 加一项，而非写死在代码里。
export function allSources() {
  const extra = [];
  if (existsSync('sources.json')) {
    try {
      const arr = JSON.parse(readFileSync('sources.json', 'utf8'));
      if (Array.isArray(arr)) for (const s of arr) extra.push({ topic: s.topic, repo: s.repo, mapsTo: s.mapsTo || 'think', localDir: s.localDir });
    } catch (e) { console.log(`   ⚠ 解析 sources.json 失败(忽略): ${e.message}`); }
  }
  return [...CURATED, ...extra];
}

// 抽取"技法表述"的特征词（真实方法/技术描述，而非标题或客套）
const TECH_RE = /(stage|阶段|RIA|提取|验证|框架|原则|案例|反例|术语|蒸馏|reason|infer|detect|recogni[sz]e|cluster|classif|tokeni[sz]e|embed|ontology|discourse|dialogue|conversation|percept|memory|belief|method|approach|technique|we (use|propose|adopt|leverage|introduce)|supports|features|capable|provides|enables|allows|using (to|for)|based on|built on|wraps|integrates|generat|synthesi[sz]|transcri[bd]|encode|decode|segment|normaliz[ei]|extract|augment|fine-?tun|pre-?train|inferenc|pipelines|models|architecture|vocabulary|language model|endpoint|REST|API|async|streaming|callback|queue|batch|parallel|chunk|split|merge|filter|mapper|reducer|pipeline|middleware|plugin|extension|interface|protocol|schema|serializ|deserializ|configur|template|scaffold|boilerplate|hybrid|cluster)/
export function extractCodeExamples(corpus) {
  const examples = [];
  const re = /```(?:js|javascript|python|ts|typescript|bash|shell|json|yaml|go|rust|mjs)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(corpus)) !== null) {
    const first = m[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('/*'))[0];
    if (first && first.length > 5 && first.length < 200) {
      examples.push(`代码示例: ${first.slice(0, 160)}`);
      if (examples.length >= 4) break;
    }
  }
  return examples;
}

export function stripNoise(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // 删除 markdown 图片（含 shields 徽章）
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // 链接保留文字
    .replace(/<[^>]+>/g, '')                    // 删除 HTML
    .replace(/https?:\/\/\S+/g, '');            // 删除裸 URL
}

// 从一组文档文本里抽取"像技法"的实质性表述行 + 代码示例
export function distillTechniques(corpus) {
  const clean = stripNoise(corpus);
  const codeExamples = extractCodeExamples(corpus);
  // 抽取含技术特征的实质行（保留特征列表行，仅排除标题和引用）
  const lines = [...new Set(
    clean.split('\n').map((l) => l.trim())
      .filter((l) => {
        if (l.length < 22 || l.length > 180) return false;
        if (/^\s*#/.test(l)) return false;                  // 仅排除标题行（# heading），保留 - /* 特征列表
        if (/^>/.test(l)) return false;                     // 排除引用块
        if (/shields\.io|badge|license|copyright|project gutenberg/i.test(l)) return false;
        return TECH_RE.test(l);
      })
      .map((l) => l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')) // 清除列表标记
  )].slice(0, 8);
  return [...lines, ...codeExamples].slice(0, 10);
}

// 读取一个目录里的候选文档（广度扫描：README/SKILL + docs/ + examples/ + 深层文档）
function readDocs(dir) {
  const docs = [];
  const candidates = [
    'README.md', 'readme.md', 'README.rst', 'SKILL.md', 'skill.md',
    'doc/README.md', 'docs/README.md', 'methodology/00-overview.md',
    'ROADMAP.md', 'docs/LLM_RESILIENCE.md',
    'GETTING_STARTED.md', 'CONTRIBUTING.md', 'EXAMPLES.md',
  ];
  for (const f of candidates) {
    const p = join(dir, f);
    if (existsSync(p)) docs.push(readFileSync(p, 'utf8'));
  }
  // 扫描 docs/ 下全部 .md 文件（非递归，避免海量噪音）
  const docsDir = join(dir, 'docs');
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) {
        if (f.endsWith('.md') && docsDir.length + f.length < 200) {
          try { docs.push(readFileSync(join(docsDir, f), 'utf8')); } catch { /* 跳过不可读 */ }
        }
      }
    } catch { /* 扫描失败静默 */ }
  }
  // 扫描 examples/ 下文档（常用于展示框架用法）
  const exDir = join(dir, 'examples');
  if (existsSync(exDir)) {
    try {
      for (const f of readdirSync(exDir)) {
        if (f.endsWith('.md') || f.includes('.example.')) {
          try { docs.push(readFileSync(join(exDir, f), 'utf8')); } catch { /* 跳过不可读 */ }
        }
      }
    } catch { /* 扫描失败静默 */ }
  }
  return docs;
}

export class Learner {
  constructor() { this.cacheDir = CACHE; }

  pickFor(entityOrTag) {
    const lower = String(entityOrTag).toLowerCase();
    if (/image|vision|see|visual/.test(lower)) return CURATED.find((c) => c.mapsTo === 'see');
    if (/audio|sound|listen|speech|transcript/.test(lower)) return CURATED.find((c) => c.mapsTo === 'listen');
    if (/think|reason|graph|logic/.test(lower)) return CURATED.find((c) => c.mapsTo === 'think');
    if (/talk|say|dialogue|communicat/.test(lower)) return CURATED.find((c) => c.mapsTo === 'talk');
    if (/observ|monitor|metric|alert|dashboard|health/.test(lower)) return [...CURATED, ...LOCAL_FALLBACK].find((c) => c.mapsTo === 'observe') || null;
    return null;
  }

  // 主入口：尝试多种来源学一个项目；失败抛错由心跳优雅降级
  async learn(repoOrSpec, topic) {
    const localDir = repoOrSpec.localDir;
    const name = localDir
      ? localDir.replace(/[\\/]$/, '').split(/[\\/]/).pop()
      : (repoOrSpec.repo || repoOrSpec.name || '').split('/').pop().replace(/\.git$/, '');

    // 1) 预置成果：外部（agent 用 Web 搜索）已注入的学习 JSON → 直接消费
    const preset = join(this.cacheDir, `${name}.learning.json`);
    if (existsSync(preset)) {
      console.log(`   [学] 消费预置学习成果: ${name}`);
      return JSON.parse(readFileSync(preset, 'utf8'));
    }

    // 1.5) 本地源（sources.json 指定的本机目录，如 omni-sense 感知系统本体）→ 直接读真实文档蒸馏
    if (localDir && existsSync(localDir)) {
      console.log(`   [学] 读本地源: ${localDir}`);
      const docs = readDocs(localDir);
      const techniques = distillTechniques(docs.join('\n'));
      const learning = {
        repo: name, repoUrl: localDir, topic,
        techniques, fetchedAt: new Date().toISOString(), source: 'local-sources',
      };
      writeFileSync(join(this.cacheDir, `${name}.learning.json`), JSON.stringify(learning, null, 2));
      return learning;
    }

    const repo = repoOrSpec.repo;
    // 2) git clone：真·去网上学（沙箱受限可能失败）
    if (repo) {
      try {
        return await this._cloneAndDistill(repo, topic);
      } catch (e) {
        console.log(`   ⚠ 克隆/蒸馏失败(优雅降级，试本地回退): ${String(e.message || e).split('\n')[0]}`);
      }
    }

    // 3) 本地回退：读取本地已存在的真实项目目录
    const local = LOCAL_FALLBACK.find((l) => l.name === name) || LOCAL_FALLBACK.find((l) => repoOrSpec.localDir && l.dir === repoOrSpec.localDir);
    if (local && existsSync(local.dir)) {
      console.log(`   [学] 克隆不可达，回退读本地项目: ${local.name} (${local.dir})`);
      const docs = readDocs(local.dir);
      const techniques = distillTechniques(docs.join('\n'));
      const learning = {
        repo: local.name, repoUrl: '(local)', topic: local.topic,
        techniques, fetchedAt: new Date().toISOString(), source: 'local-fallback',
      };
      writeFileSync(join(this.cacheDir, `${local.name}.learning.json`), JSON.stringify(learning, null, 2));
      return learning;
    }

    throw new Error(`无法学习 ${name}: 无网络克隆且本地无回退源`);
  }

  async _cloneAndDistill(repo, topic) {
    const name = repo.split('/').pop().replace(/\.git$/, '');
    const dir = join(this.cacheDir, name);
    mkdirSync(this.cacheDir, { recursive: true });
    // 清理旧目录（包装删除：本环境 fs.rmSync 被"安全删除"封装拦截，
    // 但其失败不影响克隆流程，忽略即可，由后续 execSync 超时自然降级）
    if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略删除封装限制 */ } }
    console.log(`   [学] 克隆公开项目 ${repo} ...`);
    execSync(`git clone --depth 1 ${repo} "${dir}"`, { stdio: 'pipe', timeout: 25000 });
    const docs = readDocs(dir);
    const techniques = distillTechniques(docs.join('\n'));
    const learning = {
      repo: name, repoUrl: repo, topic,
      techniques, fetchedAt: new Date().toISOString(), source: 'git-clone',
    };
    writeFileSync(join(this.cacheDir, `${name}.learning.json`), JSON.stringify(learning, null, 2));
    return learning;
  }
}
