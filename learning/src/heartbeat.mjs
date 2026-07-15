// 心跳引擎（律枢）—— 每小时一次：扫描知识缺口 → 去网上找开源项目学习 → 把技法纳入知识库。
// 零 API Key：优先 git clone 公开仓库（用户真机/有网时真实生效）；沙箱网络受限时，
// 自动回退到本地已存在的策展项目目录（如已安装的 cangjie-skill、本地框架仓库）继续真蒸馏。
// 注册为 WorkBuddy 每小时自动化后，即真实「每小时一次」持续学习与成长。
// 设计要点：克隆"成功即止"（优先轻量仓库，避免 OpenKE 偶发超时阻断整轮）；
// 学到的新技法直接存入记忆库，后续感知可引用——不重跑全图（脑已去重，重跑无新洞察）。
import { Learner, allSources } from './learner.mjs';

export class Heartbeat {
  constructor(bus, memory, opts = {}) {
    this.bus = bus;
    this.memory = memory;
    this.learner = new Learner();
    this.interval = null;
    this.maxPerCycle = opts.maxPerCycle ?? 2;
  }

  async runOnce() {
    console.log('\n═══════ [心跳] 每小时学习周期启动 ═══════');
    const gaps = this.memory.openGaps().filter((g) => g.modality !== 'belief');
    if (gaps.length) console.log(`   [心跳] 当前知识缺口 ${gaps.length} 个，优先学习相关技法`);
    else console.log('   [心跳] 暂无显式缺口，轮询策展项目保持知识新鲜（自我成长）');

    // 候选仓库去重（按 URL），来源 = 策展 + sources.json（可扩展，诚实"持续成长"）
    const seenRepo = new Set();
    const queue = [];
    for (const c of allSources()) {
      if (seenRepo.has(c.repo)) continue;
      seenRepo.add(c.repo);
      queue.push(c);
    }

    let learned = 0, inspected = 0;
    for (const c of queue) {
      inspected++;
      if (learned >= this.maxPerCycle) continue;
      try {
        const l = await this.learner.learn({ repo: c.repo, localDir: c.localDir }, c.topic);
        // 去重：已学过的同仓库不再重复计入（memory 跨周期累积，避免无限膨胀）
        const key = l.repoUrl || l.repo;
        if (!this.memory.learnings.some(x => (x.repoUrl || x.repo) === key)) {
          this.memory.addLearning(l);
          this.bus.emit('learned', l);
          learned++;
        } else {
          console.log(`   [学] 已存在，跳过重复: ${l.repo}`);
        }
      } catch (e) {
        console.log(`   ⚠ 克隆/蒸馏失败(优雅降级，试下一项): ${e.message}`);
      }
    }
    this.memory.persist();
    console.log(`   [心跳] 本周期巡检 ${inspected} 个源，新学 ${learned} 项；累计技法项目 ${this.memory.learnings.length} 个`);
    this.bus.emit('heartbeat-done', { learned, inspected });
    return learned;
  }

  startHourly() {
    this.interval = setInterval(() => this.runOnce(), 3600 * 1000);
    console.log('[心跳] 已启动每小时周期（进程内需常驻；真实部署用 WorkBuddy 每小时自动化驱动 runOnce）');
  }

  stop() { if (this.interval) clearInterval(this.interval); }
}
