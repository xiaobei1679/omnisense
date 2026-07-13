// Test decision-ledger.js: B/C/D fixes
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const NODE = process.argv[0];
const DL = path.join(__dirname, 'decision-ledger.js');

function run(cmd) {
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim());
  } catch (e) {
    try { return JSON.parse(e.stdout || '{}'); } catch { return { error: e.message }; }
  }
}

// Create a decision with vote_type
console.log('\n=== Test B) validateVoteIntegrity ===');
const create = run(`"${NODE}" "${DL}" create ${JSON.stringify(JSON.stringify({
  title: '测试投票校验',
  summary: '这是一个用来测试投票完整性校验的提案，长度足够',
  expected_outcome: '验证通过',
  risk_assessment: '低',
  rollback_plan: 'git revert',
  evidence: [{source:'test', level:'B'}],
  affected_agents: ['agent1', 'agent2', 'worldview-architect'],
  cost_estimate: {token:100, time:'5min'},
  vote_type: 'creative',
  initiator: 'test-agent'
}))}`);
console.log('Created:', create);

const id = create.decision_id;

// Vote with self_rebuttal
const v1 = run(`"${NODE}" "${DL}" vote ${id} ${JSON.stringify(JSON.stringify({
  agent: 'worldview-architect',
  stance: '创作优先',
  vote: 'approve',
  weight: 1.0,
  reasoning: '这个设定对世界观有正面贡献',
  confidence: 85,
  self_rebuttal: '但是可能会引入一些复杂度，需要后续章节确认兼容性'
}))}`);
console.log('Vote 1 (architect, approve w/ rebuttal):', v1.tally);

// Vote without self_rebuttal → should trigger weight penalty
const v2 = run(`"${NODE}" "${DL}" vote ${id} ${JSON.stringify(JSON.stringify({
  agent: 'writer',
  stance: '品质优先',
  vote: 'reject',
  weight: 1.0,
  reasoning: '这会影响当前章节的质量',
  confidence: 70,
  self_rebuttal: ''  // 空 → 应触发降权
}))}`);
console.log('Vote 2 (writer, reject, NO rebuttal):', v2.tally);

// Now close → should trigger validateVoteIntegrity
console.log('\n=== Test B) closeDecision with validation ===');
const closeResult = run(`"${NODE}" "${DL}" close ${id} ${JSON.stringify(JSON.stringify({
  status: 'executed',
  executed_by: 'test'
}))}`);
console.log('Close result:', closeResult);

// Verify the decision file
const df = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id}.json`), 'utf8'));
console.log('\nDecision status:', df.status);
console.log('Vote phase:', df.vote_phase);
console.log('Validation:', df.result.validation ? {ok: df.result.validation.ok, errors: df.result.validation.errors, warnings: df.result.validation.warnings} : 'none');

// Now test: creative without architect approve
console.log('\n=== Test B2) Creative without architect approve ===');
const create2 = run(`"${NODE}" "${DL}" create ${JSON.stringify(JSON.stringify({
  title: '创作提案无建筑师赞同',
  summary: '测试没有世界观架构师赞同的情况',
  expected_outcome: '应被拒绝',
  risk_assessment: '低',
  rollback_plan: 'revert',
  evidence: [{source:'test', level:'B'}],
  affected_agents: ['writer'],
  cost_estimate: {token:50, time:'1min'},
  vote_type: 'creative',
  initiator: 'test'
}))}`);
const id2 = create2.decision_id;

run(`"${NODE}" "${DL}" vote ${id2} ${JSON.stringify(JSON.stringify({
  agent: 'writer', stance: 'quality', vote: 'approve', weight: 1.0, confidence: 80,
  reasoning: '好提案', self_rebuttal: '这可能影响现有章节，需要后续验证调整'
}))}`);
run(`"${NODE}" "${DL}" vote ${id2} ${JSON.stringify(JSON.stringify({
  agent: 'market', stance: 'data', vote: 'reject', weight: 1.0, confidence: 60,
  reasoning: '数据不支持', self_rebuttal: '但是市场数据可能不完整，需要更多采样点'
}))}`);

const close2 = run(`"${NODE}" "${DL}" close ${id2} ${JSON.stringify(JSON.stringify({status:'executed',executed_by:'test'}))}`);
console.log('Close creative no-architect:', close2);

// Test C: Tie handling
console.log('\n=== Test C) Tie handling ===');
const create3 = run(`"${NODE}" "${DL}" create ${JSON.stringify(JSON.stringify({
  title: '平局测试提案',
  summary: '测试平局处理逻辑的提案需要足够长',
  expected_outcome: '触发平局',
  risk_assessment: '低',
  rollback_plan: 'revert',
  evidence: [{source:'test', level:'B'}],
  affected_agents: ['a1', 'a2'],
  cost_estimate: {token:100, time:'1min'},
  vote_type: 'tech',
  initiator: 'test'
}))}`);
const id3 = create3.decision_id;

// Two equal-weight votes: one approve, one reject → tie
run(`"${NODE}" "${DL}" vote ${id3} ${JSON.stringify(JSON.stringify({
  agent: 'a1', stance: 'pro', vote: 'approve', weight: 1.0, confidence: 80,
  reasoning: '赞成此方案', self_rebuttal: '但可能存在未预见的副作用需要监控'
}))}`);
run(`"${NODE}" "${DL}" vote ${id3} ${JSON.stringify(JSON.stringify({
  agent: 'a2', stance: 'con', vote: 'reject', weight: 1.0, confidence: 80,
  reasoning: '反对此方案', self_rebuttal: '不过如果加上额外约束也许可行'
}))}`);

const tieResult = run(`"${NODE}" "${DL}" close ${id3} ${JSON.stringify(JSON.stringify({status:'executed',executed_by:'test'}))}`);
console.log('Tie close result:', tieResult);
const df3 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id3}.json`), 'utf8'));
console.log('Tie status:', df3.status);
console.log('Tie count:', df3.result.tie_count);
console.log('Tie supplement needed:', df3.result.tie_supplement_needed);
console.log('Vote phase:', df3.vote_phase);

// Simulate second round: add a third vote for tie-break
console.log('\n=== Test C2) Second round tie → escalate ===');
// Add a rebuttal phase vote (same tie after add)
// Actually let's just force second tie scenario by trying to close again
const tieResult2 = run(`"${NODE}" "${DL}" close ${id3} ${JSON.stringify(JSON.stringify({status:'executed',executed_by:'test'}))}`);
console.log('Second close attempt:', tieResult2);
const df3b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id3}.json`), 'utf8'));
console.log('Tie count:', df3b.result.tie_count);
console.log('Escalated:', df3b.result.escalated_to_user);
console.log('Status:', df3b.status);

// Test D: Rebuttal phase confidence update
console.log('\n=== Test D) Rebuttal phase confidence update ===');
const create4 = run(`"${NODE}" "${DL}" create ${JSON.stringify(JSON.stringify({
  title: '反驳阶段测试',
  summary: '测试rebuttal阶段置信度修改',
  expected_outcome: '测试通过',
  risk_assessment: '低',
  rollback_plan: 'revert',
  evidence: [{source:'test', level:'B'}],
  affected_agents: ['a1'],
  cost_estimate: {token:100, time:'1min'},
  vote_type: 'tech',
  initiator: 'test'
}))}`);
const id4 = create4.decision_id;

run(`"${NODE}" "${DL}" vote ${id4} ${JSON.stringify(JSON.stringify({
  agent: 'a1', stance: 'pro', vote: 'approve', weight: 1.0, confidence: 60,
  reasoning: '初始投票', self_rebuttal: '可能存在一些边界情况没有考虑到'
}))}`);

// Manually set phase to rebuttal and update confidence
const df4 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id4}.json`), 'utf8'));
df4.vote_phase = 'rebuttal';
fs.writeFileSync(path.join(__dirname, '..', '..', '.decisions', `${id4}.json`), JSON.stringify(df4, null, 2));

// Re-vote with updated confidence
const updateVote = run(`"${NODE}" "${DL}" vote ${id4} ${JSON.stringify(JSON.stringify({
  agent: 'a1', stance: 'pro', vote: 'approve', weight: 1.0, confidence: 90,
  reasoning: '重新评估后增加信心', self_rebuttal: '经过第二轮分析，边界情况可控'
}))}`);
console.log('Updated vote:', updateVote);
const df4b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id4}.json`), 'utf8'));
console.log('Votes count:', df4b.votes.length);
console.log('Confidence after update:', df4b.votes[0]?.confidence || df4b.votes[1]?.confidence);
console.log('Phase of last vote:', df4b.votes[df4b.votes.length - 1]?.phase);

// Test: cost type with auditor weight x2
console.log('\n=== Test B3) Cost type auditor weight x2 ===');
const create5 = run(`"${NODE}" "${DL}" create ${JSON.stringify(JSON.stringify({
  title: '成本类测试',
  summary: '测试成本类审计专员权重加倍情况',
  expected_outcome: '审计权重×2',
  risk_assessment: '低',
  rollback_plan: 'revert',
  evidence: [{source:'test', level:'B'}],
  affected_agents: ['all'],
  cost_estimate: {token:100, time:'1min'},
  vote_type: 'cost',
  initiator: 'test'
}))}`);
const id5 = create5.decision_id;

run(`"${NODE}" "${DL}" vote ${id5} ${JSON.stringify(JSON.stringify({
  agent: 'auditor', stance: 'standard', vote: 'approve', weight: 1.0, confidence: 70,
  reasoning: '成本合理', self_rebuttal: '但长期成本需要持续监控'
}))}`);
run(`"${NODE}" "${DL}" vote ${id5} ${JSON.stringify(JSON.stringify({
  agent: 'agent-x', stance: 'neutral', vote: 'reject', weight: 1.0, confidence: 50,
  reasoning: '觉得太贵', self_rebuttal: '如果短期收益够大，也许可以接受'
}))}`);

const close5 = run(`"${NODE}" "${DL}" close ${id5} ${JSON.stringify(JSON.stringify({status:'executed',executed_by:'test'}))}`);
console.log('Cost close result:', close5);
const df5 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.decisions', `${id5}.json`), 'utf8'));
console.log('Tally after auditor x2:', df5.result.tally);

console.log('\n=== All decision-ledger tests done ===');
