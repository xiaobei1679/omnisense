#!/usr/bin/env node
// project-data.js — 聚合所有项目数据到单个JSON
// 用法: node project-data.js > dashboard/project-data.json

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PROJECT_DIR, HOT_DIR } = require('./lib/common.js');

const DESKTOP = path.join(os.homedir(), 'Desktop');
const PROJECTS = {
  novel: {
    name: '异兽学院',
    baseDir: PROJECT_DIR,
    subDirs: ['小说正文', '游戏原型', '音乐', '视觉', '知识库', '方案', '审核报告']
  },
  video: {
    name: '山海巨兽录',
    baseDir: path.join(DESKTOP, '山海巨兽录_产出'),
    subDirs: []
  },
  hotspot: {
    name: '每日热点',
    baseDir: HOT_DIR,
    subDirs: []
  }
};

function scanDir(dir, maxDepth = 1) {
  if (!fs.existsSync(dir)) return { files: [], dirs: [] };
  const files = [];
  const dirs = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        dirs.push({ name: item, mtime: stat.mtime, size: stat.size });
        if (maxDepth > 0) {
          const sub = scanDir(fullPath, maxDepth - 1);
          // 只统计文件数，不递归展开
        }
      } else {
        files.push({
          name: item,
          ext: path.extname(item),
          size: stat.size,
          mtime: stat.mtime
        });
      }
    }
  } catch (e) {}
  return { files, dirs };
}

function getProjectStatus(project) {
  const result = { name: project.name, sections: [] };
  
  if (project.subDirs.length === 0) {
    // 扁平目录
    const scan = scanDir(project.baseDir);
    result.totalFiles = scan.files.length;
    result.totalSize = scan.files.reduce((s, f) => s + f.size, 0);
    result.lastModified = scan.files.length 
      ? new Date(Math.max(...scan.files.map(f => f.mtime.getTime()))).toISOString()
      : null;
    result.recentFiles = scan.files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5)
      .map(f => ({ name: f.name, ext: f.ext, sizeKB: (f.size / 1024).toFixed(1), mtime: f.mtime.toISOString() }));
    result.sections.push({
      name: project.name,
      fileCount: scan.files.length,
      sizeKB: (result.totalSize / 1024).toFixed(1),
      files: result.recentFiles
    });
  } else {
    // 多子目录项目
    let totalFiles = 0;
    let totalSize = 0;
    let lastModified = null;
    
    for (const subDir of project.subDirs) {
      const subPath = path.join(project.baseDir, subDir);
      const scan = scanDir(subPath);
      const sectionSize = scan.files.reduce((s, f) => s + f.size, 0);
      const sectionLastMod = scan.files.length
        ? new Date(Math.max(...scan.files.map(f => f.mtime.getTime()))).toISOString()
        : null;
      
      totalFiles += scan.files.length;
      totalSize += sectionSize;
      if (sectionLastMod && (!lastModified || sectionLastMod > lastModified)) {
        lastModified = sectionLastMod;
      }
      
      result.sections.push({
        name: subDir,
        fileCount: scan.files.length,
        sizeKB: (sectionSize / 1024).toFixed(1),
        lastModified: sectionLastMod,
        recentFiles: scan.files
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 3)
          .map(f => ({ name: f.name, ext: f.ext, sizeKB: (f.size / 1024).toFixed(1), mtime: f.mtime.toISOString() }))
      });
    }
    
    result.totalFiles = totalFiles;
    result.totalSize = totalSize;
    result.lastModified = lastModified;
  }
  
  return result;
}

// 热点特殊处理：按日期目录
function getHotspotStatus() {
  const baseDir = HOT_DIR;
  if (!fs.existsSync(baseDir)) return { name: '每日热点', days: [], totalDirs: 0 };
  
  const dirs = fs.readdirSync(baseDir)
    .filter(d => d.startsWith('qclaw'))
    .map(d => {
      const dirPath = path.join(baseDir, d);
      const stat = fs.statSync(dirPath);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      return { date: d, fileCount: files.length, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 7); // 最近7天
  
  return {
    name: '每日热点',
    totalDirs: dirs.length,
    days: dirs
  };
}

// 输出
const data = {
  generated: new Date().toISOString(),
  projects: {
    novel: getProjectStatus(PROJECTS.novel),
    video: getProjectStatus(PROJECTS.video),
    hotspot: getHotspotStatus()
  }
};

const output = JSON.stringify(data, null, 2);
const DASHBOARD_DIR = path.join(__dirname, '..', '..', 'dashboard');
try {
  fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  fs.writeFileSync(path.join(DASHBOARD_DIR, 'project-data.json'), output, 'utf-8');
  console.log('Project data written to ' + path.join(DASHBOARD_DIR, 'project-data.json'));
} catch (e) {
  console.error('Failed to write:', e.message);
  process.stdout.write(Buffer.from(output, 'utf-8'));
}
