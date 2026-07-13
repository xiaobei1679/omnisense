import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';

// 用一个最小 stub omni 驱动路由，全程离线（不发真实网络请求）
function stubOmni() {
  return {
    status: async () => ({ runtime: 'agent', backend: 'stub' }),
    seeWebsite: async (url) => ({ modality: 'visual-web', url }),
    seeHotTopics: async (s) => ({ modality: 'visual-hot', source: s }),
    seeHotAll: async () => ({ modality: 'visual-hot-aggregate' }),
    summarizeWebsite: async (url) => ({ modality: 'visual-web-summary', url }),
    think: async (g) => ({ insight: 'stub', goal: g }),
    plan: (g) => ({ goal: g, actions: [] }),
    speak: async (t) => ({ text: t }),
    remember: (k, v) => v,
    recall: (k) => null,
    search: (q) => [],
    sense: () => ({ topicCount: 0 }),
  };
}

test('serve: /health 返回运行时', async () => {
  const server = startServer(stubOmni(), { port: 0 });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.result.runtime, 'agent');
  } finally {
    server.close();
  }
});

test('serve: POST /see 驱动 seeWebsite', async () => {
  const server = startServer(stubOmni(), { port: 0 });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/see`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com' }),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.result.url, 'http://example.com');
  } finally {
    server.close();
  }
});

test('serve: 未知路径返回 404', async () => {
  const server = startServer(stubOmni(), { port: 0 });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});

test('serve: 路由错误返回 500', async () => {
  const badOmni = { status: async () => { throw new Error('boom'); } };
  const server = startServer(badOmni, { port: 0 });
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 500);
    const j = await r.json();
    assert.equal(j.ok, false);
  } finally {
    server.close();
  }
});
