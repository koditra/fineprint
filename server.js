const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const pdfParse = require('pdf-parse');

const PORT = Number(process.env.PORT) || 3000;
const AI_ENDPOINT = 'https://ai.hackclub.com/proxy/v1/chat/completions';
const AI_MODEL = 'openai/gpt-4o-mini';
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 100_000;
const MAX_HISTORY_MESSAGES = 20;
const REQUEST_TIMEOUT_MS = 45_000;
const ROOT = __dirname;

function loadLocalEnvironment() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadLocalEnvironment();

const ACTION_PROMPTS = {
  summary: {
    label: 'Document summary',
    instruction: [
      'Summarize the document accurately in plain language.',
      'Use these sections: The gist, What matters, and Dates or money to know.',
      'Do not invent facts. If a section has no relevant information, say so.',
      'Format the response in Markdown using short headings and concise bullet lists.',
    ].join('\n'),
  },
  clauses: {
    label: 'Clause explanations',
    instruction: [
      'Identify the document clauses that are most important for an ordinary reader.',
      'For each clause, give its heading or a short identifying quote, explain its practical meaning, and note any uncertainty.',
      'Use clear bullet points. Do not present this as legal advice or infer terms that are not in the document.',
      'Format the response in Markdown using headings and bullet lists.',
    ].join('\n'),
  },
  'red-flags': {
    label: 'Potential red flags',
    instruction: [
      'Identify provisions that may deserve closer review, without assuming that unusual means unlawful.',
      'For each item, provide the relevant clause or a short quote, why it may matter, and a question the reader could ask.',
      'If no clear concerns are present, say so. Do not present this as legal advice.',
      'Format the response in Markdown using headings and bullet lists.',
    ].join('\n'),
  },
};

function buildMessages({ action, document, history = [], question = '' }) {
  const system = [
    'You are a careful document-reading assistant. Analyze only the supplied document and conversation.',
    'Distinguish what the document explicitly says from interpretation. Do not fabricate missing details.',
    'Make every answer much simpler to understand than the original document. Assume the reader has no legal background: use everyday words, short sentences, and avoid jargon. If a legal term is necessary, explain it immediately in plain language. Answer the main question first and do not talk down to the reader.',
    'You are not a lawyer and must not present responses as legal advice.',
    'Write responses in Markdown. Use headings or bullets when they make the answer easier to scan. Never output HTML.',
    `DOCUMENT:\n<document>\n${document}\n</document>`,
  ].join('\n\n');

  if (action !== 'chat') {
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `TASK: ${ACTION_PROMPTS[action].label}\n\n${ACTION_PROMPTS[action].instruction}`,
      },
    ];
  }

  const validHistory = history
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .filter((message) => typeof message.content === 'string')
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4_000),
    }));

  return [
    { role: 'system', content: system },
    ...validHistory,
    {
      role: 'user',
      content: `Answer the user's follow-up using the document. Be clear about uncertainty and cite a short relevant quote when useful. Format the answer in Markdown where helpful; never output HTML.\n\nQUESTION:\n${question}`,
    },
  ];
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

async function getDocumentText(body) {
  if (typeof body.document === 'string') return body.document.trim();

  if (typeof body.pdfBase64 !== 'string') {
    throw Object.assign(new Error('Provide document text or a PDF file.'), { status: 400 });
  }

  const encoded = body.pdfBase64.replace(/^data:application\/pdf;base64,/, '');
  if (encoded.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8) {
    throw Object.assign(new Error('PDF exceeds the 8 MB size limit.'), { status: 413 });
  }
  const pdf = Buffer.from(encoded, 'base64');
  if (pdf.length > MAX_PDF_BYTES) {
    throw Object.assign(new Error('PDF exceeds the 8 MB size limit.'), { status: 413 });
  }
  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw Object.assign(new Error('The uploaded file is not a valid PDF.'), { status: 400 });
  }

  let parsed;
  try {
    parsed = await pdfParse(pdf);
  } catch (error) {
    console.error('PDF extraction failed:', error.message);
    throw Object.assign(new Error('Could not read this PDF. Try a text-based PDF or paste its text.'), {
      status: 422,
    });
  }
  return parsed.text.trim();
}

async function handleAnalysis(request, response, fetchImpl, apiKey) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    if (!response.destroyed) {
      sendJson(response, error.status || 400, { error: error.message || 'Could not read request.' });
    }
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { error: 'Request body must be a JSON object.' });
    return;
  }
  const { action, history, question } = body;
  if (!['summary', 'clauses', 'red-flags', 'chat'].includes(action)) {
    sendJson(response, 400, { error: 'Choose a supported analysis action.' });
    return;
  }
  if (action === 'chat' && (typeof question !== 'string' || !question.trim())) {
    sendJson(response, 400, { error: 'Enter a question to continue the conversation.' });
    return;
  }
  if (action === 'chat' && question.length > 4_000) {
    sendJson(response, 413, { error: 'Questions must be 4,000 characters or fewer.' });
    return;
  }

  let document;
  try {
    document = await getDocumentText(body);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }
  if (!document) {
    sendJson(response, 400, { error: 'The document contains no readable text.' });
    return;
  }
  if (document.length > MAX_DOCUMENT_CHARS) {
    sendJson(response, 413, { error: 'Documents must contain 100,000 characters or fewer.' });
    return;
  }
  if (!apiKey) {
    sendJson(response, 503, {
      error: 'AI is not configured. Add HACKCLUB_AI_API_KEY to .env.local and restart the server.',
    });
    return;
  }

  let upstream;
  try {
    upstream = await fetchImpl(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: buildMessages({
          action,
          document,
          history: Array.isArray(history) ? history : [],
          question: typeof question === 'string' ? question.trim() : '',
        }),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    sendJson(response, timedOut ? 504 : 502, {
      error: timedOut
        ? 'The AI request timed out. Please try again.'
        : 'Could not reach Hack Club AI. Check your connection and try again.',
    });
    return;
  }

  if (!upstream.ok) {
    const retryAfter = upstream.headers.get('retry-after');
    let error = upstream.status === 429
      ? 'Hack Club AI is rate-limiting requests. Please wait a moment and try again.'
      : `Hack Club AI returned an error (${upstream.status}). Please try again.`;
    if (upstream.status >= 500) {
      error = 'Hack Club AI is temporarily unavailable. Please try again shortly.';
    }
    sendJson(response, upstream.status === 429 ? 429 : 502, { error }, retryAfter ? { 'Retry-After': retryAfter } : {});
    return;
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'Hack Club AI returned an unreadable response.' });
    return;
  }
  const answer = result?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    sendJson(response, 502, { error: 'Hack Club AI returned an empty response.' });
    return;
  }
  sendJson(response, 200, { answer: answer.trim() });
}

function createServer({ fetchImpl = global.fetch, apiKey = process.env.HACKCLUB_AI_API_KEY } = {}) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      void handleAnalysis(request, response, fetchImpl, apiKey);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST' });
      return;
    }

    const files = {
      '/': path.join(ROOT, 'index.html'),
      '/documents': path.join(ROOT, 'public', 'documents.html'),
      '/documents/': path.join(ROOT, 'public', 'documents.html'),
      '/image.jpg': path.join(ROOT, 'image.jpg'),
    };
    const filePath = files[url.pathname];
    if (!filePath) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png';
    response.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      fs.createReadStream(filePath).pipe(response);
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Fine Print is available at http://localhost:${PORT}`);
    console.log(`Document assistant: http://localhost:${PORT}/documents`);
  });
}

module.exports = {
  ACTION_PROMPTS,
  AI_ENDPOINT,
  AI_MODEL,
  buildMessages,
  createServer,
};
