/**
 * k6 Load Test — Prompt Analysis
 *
 * Usage:
 *   k6 run scripts/load-test/analyze.js -e API_URL=http://localhost:3000 -e API_KEY=ig_xxx
 *
 * Tests the proxy/analyze endpoint with realistic prompt payloads.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'ig_test_key';

const prompts = [
  'Can you summarize the latest quarterly earnings report?',
  'Draft an email to John Smith at john.smith@example.com about the contract renewal.',
  'Review this NDA between Acme Corp and Widget Inc regarding the Project Phoenix acquisition.',
  'What are the tax implications for a transfer of $500,000 from account 4532-1234-5678-9012?',
  'Help me analyze patient records for case #2024-MR-0891 — Jane Doe, DOB 03/15/1985.',
];

export default function () {
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  const payload = JSON.stringify({
    text: prompt,
    aiToolId: 'chatgpt',
    sessionId: `load-test-${__VU}-${__ITER}`,
  });

  const res = http.post(`${API_URL}/v1/proxy/analyze`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has score': (r) => {
      try { return JSON.parse(r.body).originalScore !== undefined; } catch { return false; }
    },
  });

  sleep(0.5);
}
