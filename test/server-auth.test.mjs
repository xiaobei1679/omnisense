import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 简单 fake omni：仅满足路由所需方法
function fakeOmni(runtime = 'agent') {
  return {
    status: async () => ({ runtime }),
    sense: () => ({ topicCount: 1, topics: ['x'], modalities: ['visual-hot'] }),
    plan: () => ({ goal: '', actions: ['read-hot'], synopsis: {} }),
  };
}

test('serve: 设 token 后无令牌请求返回 401', async () => {
  const server = startServer(fakeOmni(), { port: 0, token: 'secret' });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 401);
    const j = await r.json();
    assert.match(j.error, /令牌/);
  } finally {
    server.close();
  }
});

test('serve: 设 token 后 Bearer 头通过', async () => {
  const server = startServer(fakeOmni(), { port: 0, token: 'secret' });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer secret' } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.result.runtime, 'agent');
  } finally {
    server.close();
  }
});

test('serve: 设 token 后 ?token= 查询通过', async () => {
  const server = startServer(fakeOmni(), { port: 0, token: 'secret' });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health?token=secret`);
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
});

test('serve: 设 token 后错误令牌返回 401', async () => {
  const server = startServer(fakeOmni(), { port: 0, token: 'secret' });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('serve: 未设 token 时无需鉴权直接通过', async () => {
  const server = startServer(fakeOmni(), { port: 0 });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
});
