// Test quality-gate.js with vote_type
const { execSync } = require('child_process');
const path = require('path');

const NODE = process.argv[0];
const QG = path.join(__dirname, 'quality-gate.js');

function test(name, proposal) {
  try {
    const out = execSync(`"${NODE}" "${QG}" ${JSON.stringify(JSON.stringify(proposal))}`, { encoding: 'utf8', timeout: 5000 });
    console.log(`\n✅ ${name}: PASS`);
    console.log(JSON.parse(out));
  } catch (e) {
    const out = e.stdout || e.stderr || '';
    console.log(`\n❌ ${name}:`);
    try { console.log(JSON.parse(out)); } catch { console.log(out); }
  }
}

// Test 1: Valid tech proposal
test('tech提案(vote_type=tech)', {
  title: '测试技术提案',
  summary: '这是一个技术类的测试提案摘要',
  expected_outcome: '提升处理速度',
  risk_assessment: '低风险',
  rollback_plan: 'git revert',
  evidence: [{source:'文档', level:'B'}],
  affected_agents: ['agent1'],
  cost_estimate: {token:100, time:'5min'},
  vote_type: 'tech'
});

// Test 2: Valid creative proposal
test('creative提案(vote_type=creative)', {
  title: '角色设定提案',
  summary: '新增一个反派角色设定',
  expected_outcome: '丰富故事线',
  risk_assessment: '中风险',
  rollback_plan: '删除角色线',
  evidence: [{source:'历史数据', level:'A'}],
  affected_agents: ['writer', 'worldview'],
  cost_estimate: {token:200, time:'10min'},
  vote_type: 'creative'
});

// Test 3: Valid cost proposal
test('cost提案(vote_type=cost)', {
  title: '降低Token成本',
  summary: '切换更便宜的模型',
  expected_outcome: '节省30%推理成本',
  risk_assessment: '中风险',
  rollback_plan: '切回原模型',
  evidence: [{source:'成本分析', level:'A'}],
  affected_agents: ['all'],
  cost_estimate: {token:-100, time:'即时'},
  vote_type: 'cost'
});

// Test 4: Valid process proposal
test('process提案(vote_type=process)', {
  title: '优化审批流程',
  summary: '简化三级审批为两级',
  expected_outcome: '提速50%',
  risk_assessment: '低风险',
  rollback_plan: '恢复原流程',
  evidence: [{source:'流程分析', level:'B'}],
  affected_agents: ['auditor'],
  cost_estimate: {token:50, time:'1h'},
  vote_type: 'process'
});

// Test 5: Missing vote_type → should fail
test('缺失vote_type(应失败)', {
  title: '没写vote_type',
  summary: '提案缺少vote_type',
  expected_outcome: '应该失败',
  risk_assessment: '低',
  rollback_plan: 'N/A',
  evidence: [{source:'test', level:'C'}],
  affected_agents: ['x'],
  cost_estimate: {token:1, time:'1s'}
});

// Test 6: Invalid vote_type → should fail
test('无效vote_type=invalid(应失败)', {
  title: 'vote_type写错了',
  summary: 'vote_type=invalid',
  expected_outcome: '应该失败',
  risk_assessment: '低',
  rollback_plan: 'N/A',
  evidence: [{source:'test', level:'C'}],
  affected_agents: ['x'],
  cost_estimate: {token:1, time:'1s'},
  vote_type: 'invalid'
});

console.log('\n=== All quality-gate tests done ===');
