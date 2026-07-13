// Agent消息信箱 v2.0
// v2.0变更：支持Agent间互发、名字映射、unread-count快速检查、发件人记录
// 用法：
//   node mailbox.js send <from> <to> "<subject>" "<body>"
//   node mailbox.js check [agentId]
//   node mailbox.js read <agentId> [messageId|all]
//   node mailbox.js unread-count [agentId]
//   node mailbox.js list

const fs = require('fs');
const path = require('path');

const MAILBOX_DIR = path.join(__dirname, '..', '..', '.mailbox');
fs.mkdirSync(MAILBOX_DIR, { recursive: true });

const NAME_TO_ID = {
  'main': 'main',
  'qclaw': 'main',
  '小说专家': 'ds4ygtfdv3z7mmxn',
  '小说故事创作专家': 'ds4ygtfdv3z7mmxn',
  '世界观架构师': 'worldview-architect',
  'ai工程师': 'ua58rsb93veqtxl7',
  '技术制作人': 'ua58rsb93veqtxl7',
  '审核专员': 'agent-bdd9ff1a',
  '质量诊断官': 'bg0wgtn9jlge3doh',
  '记忆管家': 'ic7xj738h4v8p6g7',
  '多媒体制作人': 'media-producer',
  '商业化策略师': 'biz-strategist',
  'ds4ygtfdv3z7mmxn': 'ds4ygtfdv3z7mmxn',
  'worldview-architect': 'worldview-architect',
  'ua58rsb93veqtxl7': 'ua58rsb93veqtxl7',
  'agent-bdd9ff1a': 'agent-bdd9ff1a',
  'bg0wgtn9jlge3doh': 'bg0wgtn9jlge3doh',
  'ic7xj738h4v8p6g7': 'ic7xj738h4v8p6g7',
  'media-producer': 'media-producer',
  'biz-strategist': 'biz-strategist',
};

function resolveAgent(name) {
  const key = (name || '').toLowerCase().trim();
  return NAME_TO_ID[key] || NAME_TO_ID[name] || null;
}

function getInbox(agentId) {
  const file = path.join(MAILBOX_DIR, agentId + '.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveInbox(agentId, msgs) {
  const file = path.join(MAILBOX_DIR, agentId + '.json');
  fs.writeFileSync(file, JSON.stringify(msgs, null, 2), 'utf8');
}

const action = process.argv[2];
const args = process.argv.slice(3);

switch (action) {
  case 'send': {
    const [from, to, subject, body] = args;
    const fromId = resolveAgent(from);
    const toId = resolveAgent(to);
    if (!fromId) { console.log(JSON.stringify({ok: false, error: 'Unknown sender: ' + from})); process.exit(1); }
    if (!toId) { console.log(JSON.stringify({ok: false, error: 'Unknown recipient: ' + to})); process.exit(1); }
    const msg = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      from: fromId,
      from_name: from,
      to: toId,
      to_name: to,
      subject: subject,
      body: body,
      sent_at: new Date().toISOString(),
      read: false
    };
    const inbox = getInbox(toId);
    inbox.push(msg);
    saveInbox(toId, inbox);
    console.log(JSON.stringify({ok: true, message_id: msg.id, from: fromId, to: toId}));
    break;
  }

  case 'check': {
    const agent = args[0] || 'main';
    const agentId = resolveAgent(agent);
    if (!agentId) { console.log(JSON.stringify({ok: false, error: 'Unknown agent: ' + agent})); process.exit(1); }
    const msgs = getInbox(agentId);
    const unread = msgs.filter(m => !m.read);
    console.log(JSON.stringify({ok: true, total: msgs.length, unread: unread.length, messages: unread.slice(0, 10)}));
    break;
  }

  case 'read': {
    const [reader, msgId] = args;
    const agentId = resolveAgent(reader);
    if (!agentId) { console.log(JSON.stringify({ok: false, error: 'Unknown agent: ' + reader})); process.exit(1); }
    let msgs = getInbox(agentId);
    if (msgId === 'all' || !msgId) {
      msgs = msgs.map(m => ({...m, read: true}));
    } else {
      msgs = msgs.map(m => m.id === msgId ? {...m, read: true} : m);
    }
    saveInbox(agentId, msgs);
    console.log(JSON.stringify({ok: true, marked_read: msgId && msgId !== 'all' ? 1 : msgs.length}));
    break;
  }

  case 'unread-count': {
    const agent = args[0] || 'main';
    const agentId = resolveAgent(agent);
    if (!agentId) { console.log(JSON.stringify({ok: false, error: 'Unknown agent: ' + agent})); process.exit(1); }
    const msgs = getInbox(agentId);
    const unread = msgs.filter(m => !m.read);
    console.log(JSON.stringify({ok: true, unread: unread.length}));
    break;
  }

  case 'list': {
    const files = fs.readdirSync(MAILBOX_DIR).filter(f => f.endsWith('.json'));
    const summary = files.map(f => {
      const agentId = f.replace('.json', '');
      const m = getInbox(agentId);
      return { agent: agentId, total: m.length, unread: m.filter(x=>!x.read).length };
    });
    console.log(JSON.stringify(summary, null, 2));
    break;
  }

  default:
    console.log(JSON.stringify({
      usage: {
        send: 'node mailbox.js send <from> <to> "<subject>" "<body>"',
        check: 'node mailbox.js check [agentId]',
        read: 'node mailbox.js read <agentId> [messageId|all]',
        'unread-count': 'node mailbox.js unread-count [agentId]',
        list: 'node mailbox.js list'
      }
    }));
}
