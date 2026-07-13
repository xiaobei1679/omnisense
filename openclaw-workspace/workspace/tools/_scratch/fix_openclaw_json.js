const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE, '.qclaw', 'openclaw.json');

// 读取原始内容
let rawContent = fs.readFileSync(configPath, 'utf8');

// 尝试多个方法修复
console.log('📋 原文件大小:', rawContent.length, '字节');
console.log('前50字符:', JSON.stringify(rawContent.substring(0, 50)));

// 方法1：去除可能的BOM和非法字符
let cleaned = rawContent.replace(/^\uFEFF/, ''); // 去除BOM
cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // 去除控制字符

try {
  // 尝试解析
  const config = JSON.parse(cleaned);
  console.log('✅ 清理后JSON合法');
  
  // 添加 tomato-novelist 配置
  if (!config.skills) config.skills = {};
  if (!config.skills.entries) config.skills.entries = {};
  
  config.skills.entries['tomato-novelist'] = {
    enabled: true,
    path: path.join(process.env.USERPROFILE, '.qclaw', 'skills', 'g113593'),
    config: {}
  };
  
  // 保存修复后的配置
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('✅ 配置已修复并添加 tomato-novelist');
  
} catch (e1) {
  console.log('❌ 方法1失败:', e1.message);
  
  // 方法2：尝试逐字符修复
  try {
    // 寻找并修复常见的JSON错误
    let fixed = rawContent;
    
    // 修复可能的截断
    if (!fixed.trim().endsWith('}')) {
      console.log('⚠️ JSON似乎被截断，尝试修复...');
      // 尝试找到最后一个完整的对象
      const lastComplete = fixed.lastIndexOf('\n}');
      if (lastComplete > 0) {
        fixed = fixed.substring(0, lastComplete) + '\n  }\n}';
      }
    }
    
    const config = JSON.parse(fixed);
    console.log('✅ 方法2成功修复JSON');
    
    // 添加配置
    if (!config.skills) config.skills = {};
    if (!config.skills.entries) config.skills.entries = {};
    config.skills.entries['tomato-novelist'] = {
      enabled: true,
      path: path.join(process.env.USERPROFILE, '.qclaw', 'skills', 'g113593'),
      config: {}
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('✅ 配置已修复并保存');
    
  } catch (e2) {
    console.log('❌ 方法2也失败:', e2.message);
    console.log('需要手动修复或恢复备份');
  }
}
