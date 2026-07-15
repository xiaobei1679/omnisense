// 视觉感知模块（眼睛 / 视界引擎）—— 零 API、零外部依赖。
// 真实本地能力：
//   1) 文本 = 真·阅读：从小说/文档抽取实体与关系三元组、识别主题。
//   2) 图像 = 真·像素解码：用 Node 内置 zlib 解码 PNG，提取尺寸/主色/平均亮度
//      （不调用任何云端 VLM，纯本地字节级分析；诚实声明：不做物体识别）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as zlib from 'node:zlib';
import { extractEntities, extractTriples, detectThemes, tokenizeSentences } from '../nlp.mjs';

// ---------- PNG 编解码（仅 truecolor/RGBA 8bit、非交错，足够本地分析）----------
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function encodePng(width, height, rgb) {
  const bpp = 3, stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = rgb[i], o = y * (stride + 1) + 1 + x * bpp;
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('不是 PNG 文件');
  let off = 8, w, h, ct, bd; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`不支持的 PNG(bitDepth=${bd},colorType=${ct})`);
  const bpp = ct === 2 ? 3 : 4, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const cur = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0; let v = cur[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      out[y * stride + x] = v;
    }
  }
  const hist = {}; let rs = 0, gs = 0, bs = 0, n = 0;
  const sy = Math.max(1, Math.floor(h / 40)), sx = Math.max(1, Math.floor(w / 40));
  // 灰度采样网格（GxG），用于边缘密度与空间亮度——真实像素统计
  const G = 12; const gsamp = new Array(G * G).fill(0);
  for (let y = 0; y < h; y += sy) for (let x = 0; x < w; x += sx) {
    const i = y * stride + x * bpp, r = out[i], g = out[i + 1], b = out[i + 2];
    rs += r; gs += g; bs += b; n++;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`; hist[key] = (hist[key] || 0) + 1;
    const gi = Math.min(G - 1, Math.floor((y / h) * G)), gj = Math.min(G - 1, Math.floor((x / w) * G));
    gsamp[gi * G + gj] += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const dom = Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0].split('-').map(Number);
  // 边缘密度（简化 Sobel 梯度）：计强梯度像素占比 → 启发式「清晰/模糊」
  let edges = 0, etot = 0;
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const idx = i * G + j;
    const gl = gsamp[idx - (j > 0 ? 1 : 0)], gr = gsamp[idx + (j < G - 1 ? 1 : 0)];
    const gu = gsamp[idx - (i > 0 ? G : 0)], gd = gsamp[idx + (i < G - 1 ? G : 0)];
    etot++; if (Math.abs(gr - gl) + Math.abs(gd - gu) > 40) edges++;
  }
  const edgeDensity = +(edges / etot).toFixed(2);
  // 3x3 空间亮度网格 → 描述明暗分布
  const grid3x3 = [];
  for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) {
    const y = Math.min(h - 1, Math.floor((gi + 0.5) / 3 * h)), x = Math.min(w - 1, Math.floor((gj + 0.5) / 3 * w));
    const i = y * stride + x * bpp;
    grid3x3.push(Math.round(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]));
  }
  return {
    width: w, height: h,
    avgColor: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
    dominantColor: dom.map(v => v * 32 + 16),
    brightness: Math.round((rs + gs + bs) / (3 * n)),
    edgeDensity, grid3x3,
  };
}

// 深度图像分析（启发式，纯本地像素统计；诚实声明：非物体识别，仅颜色/亮度/纹理统计）
export function analyzeImageDeep(feat) {
  if (feat.error) return { description: '(图像不可用，已诚实降级)' };
  const aspect = feat.width / feat.height;
  const shape = aspect > 1.25 ? '横向' : aspect < 0.8 ? '纵向' : '方形';
  const tone = feat.brightness < 64 ? '暗调' : feat.brightness > 191 ? '亮调' : '中间调';
  const dCol = Math.abs(feat.dominantColor[0] - feat.avgColor[0]) + Math.abs(feat.dominantColor[1] - feat.avgColor[1]) + Math.abs(feat.dominantColor[2] - feat.avgColor[2]);
  const variety = dCol < 60 ? '低' : dCol < 160 ? '中' : '高';
  const sharp = feat.edgeDensity > 0.25 ? '清晰(边缘丰富)' : feat.edgeDensity > 0.1 ? '中等' : '平滑(边缘少)';
  const g = feat.grid3x3, maxI = g.indexOf(Math.max(...g)), minI = g.indexOf(Math.min(...g));
  const pos = ['左上', '上', '右上', '左', '中', '右', '左下', '下', '右下'];
  const description = `${shape}构图；${tone}；主色RGB(${feat.dominantColor.join(',')})；颜色丰富度${variety}；${sharp}；空间上${pos[maxI]}最亮、${pos[minI]}最暗。`;
  return { aspect: +aspect.toFixed(2), shape, tone, colorVariety: variety, sharpness: sharp, spatial: `最亮:${pos[maxI]} 最暗:${pos[minI]}`, description };
}

export class EyeModule {
  constructor(bus, memory) { this.bus = bus; this.memory = memory; }

  // 真·阅读：从真实文本（小说/文档）抽取结构
  async ingestText(source, text) {
    console.log(`\n[眼] 阅读文本(真实本地解析): ${source}`);
    const entities = extractEntities(text);
    const triples = extractTriples(text);
    const themes = detectThemes(text);
    for (const e of entities) this.memory.addEntity(e, 'concept-or-character', 'visual', source);
    for (const t of triples) this.memory.addTriple({ ...t, modality: 'visual', source });
    console.log(`   → 实体 ${entities.length} · 关系 ${triples.length} · 主题 [${themes.join('/') || '—'}]`);
    const p = { modality: 'visual', source, kind: 'text', entities, triples, themes };
    this.bus.emit('percept', p);
    return p;
  }

  // 真·看图像：本地像素解码 + 深度分析（无 VLM、无 API）
  async ingestImage(source, pathOrBuffer) {
    console.log(`\n[眼] 解析图像(本地像素解码+深度分析,无API): ${source}`);
    let feat;
    try {
      const buf = Buffer.isBuffer(pathOrBuffer)
        ? pathOrBuffer
        : (pathOrBuffer && existsSync(pathOrBuffer) ? readFileSync(pathOrBuffer) : Buffer.from(pathOrBuffer, 'base64'));
      feat = decodePng(buf);
    } catch (e) {
      console.log(`   ⚠ 图像解码失败(诚实降级): ${e.message}`);
      feat = { error: e.message };
    }
    const deep = analyzeImageDeep(feat);
    const p = { modality: 'visual', source, kind: 'image', imageFeatures: feat, visualDescription: deep.description };
    if (!feat.error) console.log(`   → 尺寸 ${feat.width}x${feat.height} · 亮度 ${feat.brightness} · 主色 RGB(${feat.dominantColor.join(',')}) · 边缘密度 ${feat.edgeDensity} · ${deep.sharpness}`);
    console.log(`   → 视觉描述: ${deep.description}`);
    this.bus.emit('percept', p);
    return p;
  }

  // 真·读文档：从结构化文本抽取标题/列表/关键句（真实本地解析，便于"读懂"非虚构文档）
  async ingestDocument(source, text) {
    console.log(`\n[眼] 解析文档结构(真实本地解析): ${source}`);
    const headings = [], bullets = [];
    for (const ln of (text || '').split(/\r?\n/)) {
      const t = ln.trim();
      if (!t) continue;
      if (/^#{1,6}\s+/.test(t)) headings.push(t.replace(/^#{1,6}\s+/, ''));
      else if (/^\d+[\.、\)]\s+/.test(t)) headings.push(t);
      else if (/^[-*]\s+/.test(t)) bullets.push(t.replace(/^[-*]\s+/, ''));
    }
    const topSentences = tokenizeSentences(text).map(s => s.trim()).filter(s => s.length > 20).slice(0, 5);
    const p = { modality: 'visual', source, kind: 'document', docStructure: { headings, bulletCount: bullets.length, topSentences } };
    console.log(`   → 标题 ${headings.length} · 列表项 ${bullets.length} · 关键句 ${topSentences.length}`);
    this.bus.emit('percept', p);
    return p;
  }

  // 生成一张本地测试图，便于演示「真·看」（不依赖任何外部资源）
  makeSampleImage(path) {
    const w = 8, h = 8, rgb = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      rgb.push([(x * 32) % 256, (y * 32) % 256, ((x + y) * 16) % 256]);
    }
    const buf = encodePng(w, h, rgb);
    if (path) writeFileSync(path, buf);
    return buf;
  }
}
