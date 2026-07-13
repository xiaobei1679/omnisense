#!/usr/bin/env node
/**
 * 角色关系图谱 (Character Relationship Graph)
 * 
 * 用法：
 *   node char-graph.js scan <file.md>              -- 扫描文件提取角色关系
 *   node char-graph.js scan <dir>                  -- 批量扫描
 *   node char-graph.js add <char1> <rel> <char2>   -- 手动添加关系
 *   node char-graph.js list                        -- 列出所有角色和关系
 *   node char-graph.js mermaid                     -- 输出mermaid关系图
 *   node char-graph.js html                        -- 输出交互式HTML图谱
 * 
 * 关系类型：师徒/朋友/敌对/暗恋/契约/亲属/同窗/上下级
 * 数据文件：.learnings/character-graph.json
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_DIR } = require('./lib/common.js');

const DATA_FILE = path.join(__dirname, '..', '.learnings', 'character-graph.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { characters: {}, relationships: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { characters: {}, relationships: [] };
  }
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 关系关键词映射
const RELATION_PATTERNS = {
  '师徒': ['师傅', '师父', '徒弟', '弟子', '师尊', '拜师'],
  '朋友': ['朋友', '兄弟', '闺蜜', '搭档', '伙伴', '战友'],
  '敌对': ['敌人', '对手', '仇人', '宿敌', '死对头'],
  '暗恋': ['暗恋', '喜欢', '心动', '爱慕', '钟情'],
  '契约': ['契约', '缔结', '绑定', '召唤', '从兽'],
  '亲属': ['父亲', '母亲', '哥哥', '姐姐', '弟弟', '妹妹', '儿子', '女儿', '叔叔', '阿姨', '爷爷', '奶奶'],
  '同窗': ['同学', '室友', '同桌', '学长', '学妹', '校友'],
  '上下级': ['队长', '组长', '部长', '院长', '老师', '教官', '领导']
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = loadData();
  
  // 提取角色名（从"XX说/道"模式）
  const speakerMatches = [...content.matchAll(/([\u4e00-\u9fff]{2,4})(?:冷声说|低声说|怒道|笑道|说道|说|道|喊道|叫道|冷声道|低声道|问道|沉声道|淡淡说|厉声道|心想|心中)/g)];
  const nameSet = new Set();
  const excludeWords = ['他们', '我们', '你们', '自己', '这个', '那个', '什么', '怎么', '为什么', '可是', '但是', '因为', '所以', '如果', '虽然', '不过', '而且', '然后', '忽然', '突然', '于是'];
  
  speakerMatches.forEach(m => {
    const name = m[1];
    if (!excludeWords.includes(name)) nameSet.add(name);
  });
  
  // 登记角色
  nameSet.forEach(name => {
    if (!data.characters[name]) {
      data.characters[name] = { mentions: 0, firstSeen: filePath };
    }
    data.characters[name].mentions++;
  });
  
  // 提取关系
  const foundRels = [];
  Object.entries(RELATION_PATTERNS).forEach(([relType, keywords]) => {
    keywords.forEach(kw => {
      const regex = new RegExp(`([\u4e00-\u9fff]{2,4})${kw}([\u4e00-\u9fff]{2,4})`, 'g');
      const matches = [...content.matchAll(regex)];
      matches.forEach(m => {
        const char1 = m[1];
        const char2 = m[2];
        if (excludeWords.includes(char1) || excludeWords.includes(char2)) return;
        
        const exists = data.relationships.find(r => 
          r.from === char1 && r.to === char2 && r.type === relType
        );
        if (!exists) {
          data.relationships.push({
            from: char1,
            to: char2,
            type: relType,
            keyword: kw,
            source: path.basename(filePath)
          });
          foundRels.push({ from: char1, to: char2, type: relType });
        }
      });
    });
  });
  
  // 同段落共现检测（两人名在100字内出现 = 可能有关联）
  const names = [...nameSet];
  const segSize = 100;
  const allCJK = content.match(/[\u4e00-\u9fff]+/g) || [];
  for (let i = 0; i < allCJK.length; i += segSize) {
    const seg = allCJK.slice(i, i + segSize).join('');
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) {
        if (seg.includes(names[a]) && seg.includes(names[b])) {
          const exists = data.relationships.find(r =>
            ((r.from === names[a] && r.to === names[b]) || (r.from === names[b] && r.to === names[a])) &&
            r.type === '共现'
          );
          if (!exists) {
            data.relationships.push({
              from: names[a],
              to: names[b],
              type: '共现',
              source: path.basename(filePath)
            });
          }
        }
      }
    }
  }
  
  saveData(data);
  
  console.log(`\n=== 扫描结果：${path.basename(filePath)} ===`);
  console.log(`角色：${nameSet.size}个`);
  console.log(`新关系：${foundRels.length}条`);
  if (foundRels.length > 0) {
    foundRels.forEach(r => console.log(`  ${r.from} --[${r.type}]--> ${r.to}`));
  }
  
  return { characters: [...nameSet], relationships: foundRels };
}

function add(char1, rel, char2) {
  const data = loadData();
  if (!data.characters[char1]) data.characters[char1] = { mentions: 0, firstSeen: 'manual' };
  if (!data.characters[char2]) data.characters[char2] = { mentions: 0, firstSeen: 'manual' };
  
  const exists = data.relationships.find(r =>
    r.from === char1 && r.to === char2 && r.type === rel
  );
  if (exists) {
    console.log(`关系已存在`);
    return;
  }
  
  data.relationships.push({
    from: char1,
    to: char2,
    type: rel,
    source: 'manual'
  });
  saveData(data);
  console.log(`✅ ${char1} --[${rel}]--> ${char2}`);
}

function list() {
  const data = loadData();
  const charNames = Object.keys(data.characters);
  
  if (charNames.length === 0) {
    console.log('暂无角色数据');
    return;
  }
  
  console.log('=== 角色列表 ===');
  charNames.sort((a, b) => data.characters[b].mentions - data.characters[a].mentions);
  charNames.forEach(name => {
    const c = data.characters[name];
    console.log(`  👤 ${name}（提及${c.mentions}次）`);
  });
  
  console.log(`\n=== 关系列表（${data.relationships.length}条）===`);
  data.relationships.forEach(r => {
    console.log(`  ${r.from} --[${r.type}]--> ${r.to} (${r.source})`);
  });
}

function mermaid() {
  const data = loadData();
  if (Object.keys(data.characters).length === 0) {
    console.log('暂无角色数据');
    return;
  }
  
  console.log('```mermaid');
  console.log('graph TD');
  
  // 节点
  Object.keys(data.characters).forEach(name => {
    const id = name.replace(/[^\w]/g, '_');
    console.log(`  ${id}["${name}"]`);
  });
  
  // 关系（去重，只保留非共现的）
  const seen = new Set();
  data.relationships.filter(r => r.type !== '共现').forEach(r => {
    const key = `${r.from}-${r.type}-${r.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    const fromId = r.from.replace(/[^\w]/g, '_');
    const toId = r.to.replace(/[^\w]/g, '_');
    console.log(`  ${fromId} -->|${r.type}| ${toId}`);
  });
  
  console.log('```');
}

function html() {
  const data = loadData();
  if (Object.keys(data.characters).length === 0) {
    console.log('暂无角色数据');
    return;
  }
  
  const chars = Object.keys(data.characters).map((name, i) => ({
    id: i,
    label: name,
    mentions: data.characters[name].mentions
  }));
  
  const rels = data.relationships
    .filter(r => r.type !== '共现')
    .map(r => {
      const fromIdx = chars.findIndex(c => c.label === r.from);
      const toIdx = chars.findIndex(c => c.label === r.to);
      return fromIdx >= 0 && toIdx >= 0 ? { source: fromIdx, target: toIdx, type: r.type } : null;
    })
    .filter(Boolean);
  
  const htmlContent = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>角色关系图谱 - 异兽学院</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; color: #eee; font-family: 'Microsoft YaHei', sans-serif; overflow: hidden; }
#canvas { width: 100vw; height: 100vh; position: relative; }
.node { position: absolute; padding: 10px 20px; background: #16213e; border: 2px solid #0f3460; border-radius: 25px; cursor: pointer; transition: all 0.3s; user-select: none; }
.node:hover { background: #0f3460; border-color: #e94560; transform: scale(1.1); z-index: 10; }
.node .name { font-size: 14px; font-weight: bold; }
.node .info { font-size: 11px; color: #888; margin-top: 2px; }
svg { position: absolute; top: 0; left: 0; pointer-events: none; }
.line { stroke: #0f3460; stroke-width: 1.5; fill: none; }
.line-label { fill: #e94560; font-size: 11px; text-anchor: middle; }
.legend { position: fixed; top: 20px; right: 20px; background: #16213e; padding: 15px; border-radius: 10px; border: 1px solid #0f3460; }
.legend h3 { font-size: 14px; margin-bottom: 10px; }
.legend-item { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; }
.legend-color { width: 20px; height: 3px; }
</style>
</head>
<body>
<div id="canvas">
  <svg id="lines" width="100%" height="100%"></svg>
  <div class="legend">
    <h3>关系类型</h3>
    ${[...new Set(rels.map(r => r.type))].map(t => `<div class="legend-item"><div class="legend-color" style="background:${getColor(t)}"></div>${t}</div>`).join('')}
  </div>
</div>
<script>
const chars = ${JSON.stringify(chars)};
const rels = ${JSON.stringify(rels)};
const relColors = {${[...new Set(rels.map(r => r.type))].map(t => `"${t}": "${getColor(t)}"`).join(',')}};

function getColor(type) { return relColors[type] || '#666'; }

// 布局：圆形分布
const cx = window.innerWidth / 2;
const cy = window.innerHeight / 2;
const radius = Math.min(window.innerWidth, window.innerHeight) * 0.35;
chars.forEach((c, i) => {
  const angle = (i / chars.length) * 2 * Math.PI - Math.PI / 2;
  c.x = cx + radius * Math.cos(angle);
  c.y = cy + radius * Math.sin(angle);
});

// 渲染节点
const canvas = document.getElementById('canvas');
chars.forEach(c => {
  const div = document.createElement('div');
  div.className = 'node';
  div.style.left = (c.x - 50) + 'px';
  div.style.top = (c.y - 20) + 'px';
  div.innerHTML = '<div class="name">' + c.label + '</div><div class="info">提及' + c.mentions + '次</div>';
  div.dataset.id = c.id;
  canvas.appendChild(div);
});

// 渲染连线
const svg = document.getElementById('lines');
rels.forEach(r => {
  const from = chars[r.source];
  const to = chars[r.target];
  if (!from || !to) return;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y);
  line.setAttribute('class', 'line');
  line.setAttribute('stroke', getColor(r.type));
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);
  
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', midX);
  text.setAttribute('y', midY - 5);
  text.setAttribute('class', 'line-label');
  text.setAttribute('fill', getColor(r.type));
  text.textContent = r.type;
  svg.appendChild(text);
});
</script>
</body>
</html>`;
  
  const outPath = path.join(PROJECT_DIR, '角色关系图谱.html');
  fs.writeFileSync(outPath, htmlContent, 'utf-8');
  console.log(`✅ 交互式图谱已生成：${outPath}`);
}

function getColor(type) {
  const colors = {
    '师徒': '#e94560', '朋友': '#0f3460', '敌对': '#ff6b6b',
    '暗恋': '#ff9ff3', '契约': '#feca57', '亲属': '#48dbfb',
    '同窗': '#1dd1a1', '上下级': '#a29bfe', '共现': '#636e72'
  };
  return colors[type] || '#666';
}

// CLI
const [,, cmd, ...args] = process.argv;
const commands = { scan: (f) => scanFile(f), add, list, mermaid, html };
if (commands[cmd]) {
  if (cmd === 'scan' && fs.existsSync(args[0]) && fs.statSync(args[0]).isDirectory()) {
    const files = fs.readdirSync(args[0]).filter(f => f.endsWith('.md')).map(f => path.join(args[0], f));
    files.forEach(f => scanFile(f));
  } else {
    commands[cmd](...args);
  }
} else {
  console.log('用法: node char-graph.js [scan|add|list|mermaid|html]');
}
