// mailbox-test.js - 用纯ASCII测试mailbox
const { execFileSync } = require('child_process');
const path = require('path');
const nodePath = process.execPath;
const scriptPath = path.join(__dirname, '..', 'mailbox.js');

function run(...args) {
  try {
    const out = execFileSync(nodePath, [scriptPath, ...args], {encoding: 'utf8', timeout: 5000});
    console.log(out.trim());
  } catch(e) {
    console.log('ERROR:', e.stderr || e.message);
  }
}

console.log('=== SEND ===');
run('send', 'main', 'ds4ygtfdv3z7mmxn', 'test', 'test body');

console.log('=== CHECK ===');
run('check', 'ds4ygtfdv3z7mmxn');

console.log('=== UNREAD-COUNT ===');
run('unread-count', 'ds4ygtfdv3z7mmxn');

console.log('=== READ ALL ===');
run('read', 'ds4ygtfdv3z7mmxn', 'all');

console.log('=== UNREAD-COUNT AFTER ===');
run('unread-count', 'ds4ygtfdv3z7mmxn');
