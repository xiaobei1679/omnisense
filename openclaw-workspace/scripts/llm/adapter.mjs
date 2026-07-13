// scripts/llm/adapter.mjs
// Adapter layer for openclaw-workspace.
//
// The repo already speaks the OpenAI Chat Completions protocol
// (`POST {baseUrl}/chat/completions`). Ollama, DeepSeek, Qwen/DashScope,
// Moonshot (Kimi), and SiliconFlow all expose an OpenAI-compatible endpoint,
// so the SAME agent scripts run on any of them — you just point the right
// base URL + model + key at them.
//
// This module is the thin, zero-dependency "Adapter layer" from ROADMAP:
// given a short provider name (or explicit base/model/key overrides) it
// resolves the effective connection config, builds request headers, and
// normalizes request/response shapes. No network is required to use the
// pure helpers; `createClient` only touches `fetch` when you actually call it.
//
// Exported pure functions (unit-tested in tests/adapter.test.mjs):
//   PROVIDERS, normalizeProviderName, resolveProvider, chatCompletionsUrl,
//   buildHeaders, normalizeMessages, buildConfig, parseCompletion, createClient
//
// CLI:
//   node scripts/llm/adapter.mjs --list
//   node scripts/llm/adapter.mjs --provider deepseek
//   node scripts/llm/adapter.mjs --provider ollama --model qwen2.5-coder:3b

// Known providers. All expose an OpenAI-compatible /v1/chat/completions.
// `apiKeyEnv` is the env var the user supplies their key in (auto-read by buildConfig).
export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'LLM_API_KEY',
    keyRequired: true,
    notes: 'Default. Set LLM_API_KEY.',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    keyRequired: true,
    notes: 'Set DEEPSEEK_API_KEY (optional LLM_MODEL).',
  },
  qwen: {
    label: 'Qwen / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    keyRequired: true,
    notes: 'Aliyun DashScope OpenAI-compat mode.',
  },
  moonshot: {
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    keyRequired: true,
    notes: 'Kimi. Set MOONSHOT_API_KEY.',
  },
  siliconflow: {
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    keyRequired: true,
    notes: 'Set SILICONFLOW_API_KEY.',
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:3b',
    apiKeyEnv: '',
    keyRequired: false,
    notes: 'Local, zero-key. Needs `ollama serve`.',
  },
};

// User-friendly aliases → canonical provider id.
const ALIASES = {
  gpt: 'openai', openai: 'openai',
  deepseek: 'deepseek',
  qwen: 'qwen', dashscope: 'qwen', aliyun: 'qwen', tongyi: 'qwen',
  kimi: 'moonshot', moonshot: 'moonshot',
  siliconflow: 'siliconflow', silicon: 'siliconflow',
  ollama: 'ollama', local: 'ollama',
};

// Normalize a provider name: lowercase, alias-resolve, '' → 'openai'.
export function normalizeProviderName(name) {
  if (!name) return 'openai';
  const n = String(name).trim().toLowerCase();
  return ALIASES[n] || n;
}

// Resolve a provider name to its full config. Throws on unknown.
export function resolveProvider(name) {
  const key = normalizeProviderName(name);
  const p = PROVIDERS[key];
  if (!p) {
    throw new Error(
      `unknown provider: ${name} (known: ${Object.keys(PROVIDERS).join(', ')})`
    );
  }
  return { id: key, ...p };
}

// Build the chat/completions URL (strips trailing slashes, appends path).
export function chatCompletionsUrl(baseUrl) {
  const u = String(baseUrl || '').replace(/\/+$/, '');
  if (!u) throw new Error('chatCompletionsUrl: empty baseUrl');
  return `${u}/chat/completions`;
}

// Build request headers. Adds Bearer auth only when a key is present.
export function buildHeaders(apiKey, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

const ROLES = new Set(['system', 'user', 'assistant', 'tool', 'function']);

// Normalize a messages array into [{role, content}].
// Accepts plain strings (→ user) and role objects; rejects bad roles.
export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('normalizeMessages: expected array');
  return messages.map((m, i) => {
    if (typeof m === 'string') return { role: 'user', content: m };
    if (!m || typeof m !== 'object') {
      throw new Error(`normalizeMessages[${i}]: invalid entry`);
    }
    const role = String(m.role || 'user').toLowerCase();
    if (!ROLES.has(role)) {
      throw new Error(`normalizeMessages[${i}]: bad role "${m.role}"`);
    }
    const content = m.content == null ? '' : String(m.content);
    return { role, content };
  });
}

const LOCAL_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0|ollama/i;

// Resolve the effective connection config.
// Precedence: explicit baseUrl overrides provider defaults. When no baseUrl is
// given, the named provider (LLM_PROVIDER) supplies baseUrl/model/key-env.
// Behavior is identical to the legacy LLM_BASE_URL/LLM_MODEL/LLM_API_KEY flow
// when none of these are set (defaults to OpenAI + gpt-4o-mini).
export function buildConfig(opts = {}) {
  const {
    provider,
    baseUrl,
    model,
    apiKey,
    apiKeyEnv = 'LLM_API_KEY',
  } = opts;

  // 1) Explicit base URL wins (legacy behavior — e.g. a custom OpenAI-compat proxy).
  if (baseUrl) {
    const resolvedKey = apiKey || (apiKeyEnv ? process.env[apiKeyEnv] || '' : '');
    const isLocal = LOCAL_RE.test(baseUrl) || /ollama/i.test(model || '');
    return {
      provider: 'custom',
      baseUrl: String(baseUrl).replace(/\/+$/, ''),
      model: model || 'gpt-4o-mini',
      apiKey: resolvedKey,
      apiKeyEnv,
      isLocal,
      keyRequired: !isLocal,
    };
  }

  // 2) Resolve from a known provider name (LLM_PROVIDER).
  const p = resolveProvider(provider);
  const resolvedKey = apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || '' : '');
  const isLocal =
    p.id === 'ollama' || LOCAL_RE.test(p.baseUrl) || /ollama/i.test(model || '');
  return {
    provider: p.id,
    baseUrl: p.baseUrl,
    model: model || p.defaultModel,
    apiKey: resolvedKey,
    apiKeyEnv: p.apiKeyEnv,
    isLocal,
    keyRequired: p.keyRequired && !isLocal,
  };
}

// Extract assistant text from a chat/completions response object.
export function parseCompletion(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('parseCompletion: empty response');
  }
  const choice = Array.isArray(data.choices) && data.choices[0];
  if (!choice || !choice.message) {
    throw new Error('parseCompletion: no choices[0].message');
  }
  return choice.message.content || '';
}

// Build a bound chat client. Uses the global `fetch` (Node 18+) by default.
// Mirrors the timeout/retry hardening already in scripts/agent/respond.mjs.
//
// The fetch implementation is injectable via `opts.fetch` — this is the
// dependency-injection seam that lets tests (or proxies / logging middleware)
// substitute a fake without polluting product code with `if TESTING:` branches.
// Passing a fake fetch is also the sanctioned way to write a Tier-1 "stub fake"
// that asserts the real request contract (URL / headers / body) rather than a
// canned string that silently lies about production behavior.
export function createClient(config, opts = {}) {
  const cfg = buildConfig(config);
  const endpoint = chatCompletionsUrl(cfg.baseUrl);
  const timeoutMs = parseInt(opts.timeoutMs || process.env.LLM_TIMEOUT_MS || '120000', 10);
  const retries = parseInt(opts.retries || process.env.LLM_RETRIES || '1', 10);
  const maxBytes = parseInt(opts.maxBytes || (2 * 1024 * 1024), 10);
  const temperature = opts.temperature == null ? 0.2 : opts.temperature;
  const fetchImpl = opts.fetch || globalThis.fetch;

  async function chat(system, user, attempt = 0) {
    const messages = normalizeMessages([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = buildHeaders(cfg.apiKey);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({ model: cfg.model, temperature, messages }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      const cl = parseInt(res.headers.get('content-length') || '0', 10);
      if (cl > maxBytes) throw new Error(`LLM response too large (${cl} bytes)`);
      const data = await res.json();
      return parseCompletion(data);
    } catch (e) {
      // Retry once on transient network failures.
      if (
        attempt < retries &&
        (e.name === 'AbortError' ||
          e.cause?.code === 'ECONNRESET' ||
          e.cause?.code === 'ECONNREFUSED')
      ) {
        return chat(system, user, attempt + 1);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return { config: cfg, endpoint, chat, fetchImpl };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function maskKey(k) {
  if (!k) return '(none)';
  return k.length <= 6 ? '***' : k.slice(0, 3) + '…' + k.slice(-3);
}

function printList() {
  console.log('Known LLM providers (OpenAI-compatible /chat/completions):');
  for (const [id, p] of Object.entries(PROVIDERS)) {
    console.log(
      `  ${id.padEnd(12)} ${p.label.padEnd(20)} ${p.baseUrl}  model=${p.defaultModel}` +
        (p.keyRequired ? `  key=${p.apiKeyEnv}` : '  (no key)')
    );
  }
}

function printProvider(name, opts = {}) {
  const cfg = buildConfig({ provider: name, model: opts.model });
  console.log(`provider:   ${cfg.provider} (${PROVIDERS[cfg.provider]?.label || 'custom'})`);
  console.log(`baseUrl:    ${cfg.baseUrl}`);
  console.log(`endpoint:   ${chatCompletionsUrl(cfg.baseUrl)}`);
  console.log(`model:      ${cfg.model}`);
  console.log(`apiKeyEnv:  ${cfg.apiKeyEnv || '(none)'}`);
  console.log(`apiKey:     ${maskKey(cfg.apiKey)}`);
  console.log(`isLocal:    ${cfg.isLocal}`);
  console.log(`keyRequired:${cfg.keyRequired}`);
}

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => {
    const i = args.indexOf(f);
    return i !== -1 ? args[i + 1] : undefined;
  };
  if (has('--list')) {
    printList();
    return;
  }
  const provider = val('--provider') || val('-p') || process.env.LLM_PROVIDER;
  if (!provider) {
    console.error('adapter: no provider given. Use --list or --provider <name>.');
    process.exit(1);
  }
  try {
    printProvider(provider, { model: val('--model') });
  } catch (e) {
    console.error(`adapter: ${e.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('adapter.mjs');
if (isMain) {
  main();
}
