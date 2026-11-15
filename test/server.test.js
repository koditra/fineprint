const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ACTION_PROMPTS,
  AI_ENDPOINT,
  AI_MODEL,
  buildMessages,
  createServer,
} = require('../server');

async function startServer(t, options) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves the casual start page at the homepage and the workspace at /documents', async (t) => {
  const baseUrl = await startServer(t, { apiKey: '' });
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Ever open a document and immediately start skimming/);
  assert.match(html, /We made Fine Print at a hackathon/);
  assert.match(html, /Keep asking/);
  assert.match(html, /app\.koditra\.xyz/);
  assert.match(html, /href="\/documents#upload-document"/);
  assert.match(html, /href="\/documents#document-text"/);

  const workspaceResponse = await fetch(`${baseUrl}/documents`);
  const workspaceHtml = await workspaceResponse.text();
  assert.equal(workspaceResponse.status, 200);
  assert.match(workspaceHtml, /<title>Home<\/title>/);
  assert.match(workspaceHtml, /Let's figure this out/);
  assert.match(workspaceHtml, /id="paper-crackle"/);
});

test('builds a structured, document-grounded prompt for each analysis action', () => {
  for (const [action, prompt] of Object.entries(ACTION_PROMPTS)) {
    const messages = buildMessages({ action, document: 'Agreement text' });
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /Agreement text/);
    assert.match(messages[0].content, /Markdown/);
    assert.match(messages[0].content, /much simpler to understand/i);
    assert.match(messages[0].content, /no legal background/i);
    assert.match(messages[0].content, /everyday words/i);
    assert.match(messages[1].content, new RegExp(prompt.label));
    assert.match(messages[1].content, /Markdown/);
  }
});

test('includes conversation history and the current question for follow-up chat', () => {
  const messages = buildMessages({
    action: 'chat',
    document: 'Agreement text',
    history: [
      { role: 'system', content: 'must be ignored' },
      { role: 'user', content: 'What is the term?' },
      { role: 'assistant', content: 'One year.' },
    ],
    question: 'Can it renew?',
  });
  assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'assistant', 'user']);
  assert.match(messages.at(-1).content, /Can it renew\?/);
  assert.match(messages.at(-1).content, /Markdown/);
});

test('sends the OpenAI-compatible request only to Hack Club and returns its answer', async (t) => {
  let capturedUrl;
  let capturedOptions;
  const baseUrl = await startServer(t, {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ choices: [{ message: { content: 'A clear summary.' } }] }),
      };
    },
  });

  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'summary', document: 'Agreement text' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answer: 'A clear summary.' });
  assert.equal(capturedUrl, AI_ENDPOINT);
  assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(capturedOptions.body), {
    model: AI_MODEL,
    messages: buildMessages({ action: 'summary', document: 'Agreement text' }),
  });
});

test('reports missing server API configuration without making an upstream request', async (t) => {
  let called = false;
  const baseUrl = await startServer(t, {
    apiKey: '',
    fetchImpl: async () => {
      called = true;
      throw new Error('should not be called');
    },
  });
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'summary', document: 'Agreement text' }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /HACKCLUB_AI_API_KEY/);
  assert.equal(called, false);
});

test('returns rate-limit status and retry guidance from Hack Club', async (t) => {
  const baseUrl = await startServer(t, {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    }),
  });
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'summary', document: 'Agreement text' }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '12');
  assert.match((await response.json()).error, /rate-limiting/);
});

test('returns a gateway timeout when the upstream request times out', async (t) => {
  const baseUrl = await startServer(t, {
    apiKey: 'test-key',
    fetchImpl: async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'summary', document: 'Agreement text' }),
  });
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /timed out/i);
});
