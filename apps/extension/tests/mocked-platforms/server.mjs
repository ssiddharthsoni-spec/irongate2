/**
 * IronGate Mock Platform Server
 *
 * Serves mocked UIs for ChatGPT, Claude, Gemini, and Perplexity.
 * Each UI exactly mirrors the real platform's DOM structure so IronGate's
 * adapter selectors fire correctly. The mock API endpoints accept
 * pseudonymized requests and return controlled responses containing
 * the pseudonyms — allowing tests to verify de-pseudonymization.
 *
 * Usage:
 *   node server.mjs
 *   # Then open http://localhost:9000/chatgpt, /claude, /gemini, /perplexity
 *
 * Intercepted payloads are stored in memory and exposed at GET /api/intercepted
 * so Playwright tests can assert on what IronGate actually sent.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9000;

// ── In-memory interception log ────────────────────────────────────────────────
const interceptedRequests = [];

function logIntercepted(platform, payload) {
  interceptedRequests.push({ platform, payload, timestamp: Date.now() });
  console.log(`[INTERCEPTED] ${platform}:`, JSON.stringify(payload).slice(0, 200));
}

// ── SSE helper ────────────────────────────────────────────────────────────────
function sendSSE(res, data) {
  const frame = `data: ${JSON.stringify(data)}\n\n`;
  // WP4: split every frame across two network writes at an awkward byte
  // position — real platforms chunk arbitrarily, and pseudonyms straddling
  // the cut were the recurring leak class (DEF-031). Emitting whole frames
  // meant the e2e suite could never catch chunk-boundary regressions.
  if (frame.length > 12) {
    const cut = Math.floor(frame.length / 2) + 3;
    res.write(frame.slice(0, cut));
    res.write(frame.slice(cut));
  } else {
    res.write(frame);
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Static HTML pages ─────────────────────────────────────────────────────
  const htmlMap = {
    '/chatgpt': 'chatgpt.html',
    '/claude': 'claude.html',
    '/gemini': 'gemini.html',
    '/perplexity': 'perplexity.html',
  };

  if (htmlMap[url.pathname]) {
    const filePath = path.join(__dirname, htmlMap[url.pathname]);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(filePath, 'utf8'));
      return;
    }
  }

  // ── Intercepted log (for Playwright assertions) ──────────────────────────
  if (url.pathname === '/api/intercepted') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(interceptedRequests));
    return;
  }

  if (url.pathname === '/api/intercepted/clear') {
    interceptedRequests.length = 0;
    res.writeHead(200); res.end('cleared');
    return;
  }

  // ── ChatGPT Mock API ─────────────────────────────────────────────────────
  // Matches: /backend-api/conversation
  if (url.pathname.includes('/backend-api/conversation')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }

      const userMsg = parsed?.messages?.slice(-1)[0]?.content?.parts?.[0] || 'unknown';
      logIntercepted('chatgpt', { body: userMsg, rawLength: body.length });

      // Stream back an SSE response containing the pseudonym so de-pseudo is tested
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Return a response that echoes back what we received (contains pseudonym)
      const chunks = [
        { message: { id: 'msg1', author: { role: 'assistant' }, content: { parts: [`I received your message about `] } } },
        { message: { id: 'msg1', author: { role: 'assistant' }, content: { parts: [`I received your message about ${userMsg} and can help.`] } } },
        '[DONE]',
      ];

      let i = 0;
      const interval = setInterval(() => {
        if (i >= chunks.length) { clearInterval(interval); res.end(); return; }
        const chunk = chunks[i++];
        if (chunk === '[DONE]') res.write('data: [DONE]\n\n');
        else sendSSE(res, chunk);
      }, 50);
    });
    return;
  }

  // ── Claude Mock API ──────────────────────────────────────────────────────
  // Matches: /api/organizations/{id}/chat_conversations/{id}/completion
  if (url.pathname.includes('/completion') || url.pathname.includes('/api/append_message')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }

      const userMsg = parsed?.text || parsed?.prompt || 'unknown';
      logIntercepted('claude', { body: userMsg, rawLength: body.length });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      // Claude SSE format: event: completion, data: { completion: "..." }
      const responses = [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `I received your message: ` } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: userMsg } },
        { type: 'message_stop' },
      ];

      let i = 0;
      const interval = setInterval(() => {
        if (i >= responses.length) { clearInterval(interval); res.end(); return; }
        res.write(`event: ${responses[i].type}\n`);
        sendSSE(res, responses[i++]);
      }, 50);
    });
    return;
  }

  // ── Gemini DOM pre-submit: no API interception needed ────────────────────
  // Gemini uses DOM pre-submit — the extension writes pseudonymized text to the
  // Quill editor before the user presses send. We intercept the form submission.
  if (url.pathname === '/gemini-submit') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      logIntercepted('gemini', { submittedText: parsed.text, rawLength: body.length });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response: `Here is my response to: ${parsed.text}`,
        candidates: [{ content: { parts: [{ text: `Response for: ${parsed.text}` }] } }],
      }));
    });
    return;
  }

  // ── Perplexity REST fallback ─────────────────────────────────────────────
  if (url.pathname.includes('/api/query') || url.pathname.includes('/api/search')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      const query = parsed?.text || parsed?.query_str || parsed?.query || 'unknown';
      logIntercepted('perplexity', { query, rawLength: body.length });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        answer: `Search results for: ${query}`,
        text: `I found information about ${query}`,
      }));
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end(`Not found: ${url.pathname}`);
});

// ── WebSocket Server (Perplexity Socket.IO mock) ──────────────────────────────
const wss = new WebSocketServer({ server, path: '/socket.io/' });

wss.on('connection', (ws, req) => {
  console.log('[WS] Perplexity Socket.IO connection');

  // Send Socket.IO handshake
  ws.send('0{"sid":"mock-session-id","upgrades":[],"pingInterval":25000,"pingTimeout":5000}');
  ws.send('40'); // connect acknowledgment

  ws.on('message', (data) => {
    const msg = data.toString();
    console.log('[WS] Received:', msg.slice(0, 200));

    // Socket.IO format: 42["perplexity_ask","query text",{options}]
    if (msg.startsWith('42')) {
      try {
        const payload = JSON.parse(msg.slice(2));
        if (payload[0] === 'perplexity_ask') {
          const query = payload[1];
          logIntercepted('perplexity', { query, source: 'websocket' });

          // Send back response containing the query (to test de-pseudonymization)
          setTimeout(() => {
            ws.send(`42["query_progress",{"status":"searching","text":"Searching for: ${query}"}]`);
          }, 100);
          setTimeout(() => {
            ws.send(`42["query_progress",{"status":"complete","text":"Results for ${query}: Here is what I found about ${query}."}]`);
          }, 300);
          setTimeout(() => {
            ws.send(`42["query_answered",{"query":"${query}","answer":"Based on ${query}, the answer is..."}]`);
          }, 500);
        }
      } catch { /* ignore parse errors */ }
    }

    // Pong
    if (msg === '2') ws.send('3');
  });
});

server.listen(PORT, () => {
  console.log(`\n🛡️  IronGate Mock Platform Server running at http://localhost:${PORT}`);
  console.log(`\n  Platforms:`);
  console.log(`   ChatGPT   → http://localhost:${PORT}/chatgpt`);
  console.log(`   Claude    → http://localhost:${PORT}/claude`);
  console.log(`   Gemini    → http://localhost:${PORT}/gemini`);
  console.log(`   Perplexity→ http://localhost:${PORT}/perplexity`);
  console.log(`\n  API:`);
  console.log(`   Intercepted log → http://localhost:${PORT}/api/intercepted`);
  console.log(`   Clear log       → http://localhost:${PORT}/api/intercepted/clear`);
  console.log(`\n  Load the IronGate extension, then open any platform URL.\n`);
});
