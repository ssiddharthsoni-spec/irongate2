/**
 * k6 Load Test — Event Ingestion
 *
 * Usage:
 *   k6 run scripts/load-test/events.js -e API_URL=http://localhost:3000 -e API_KEY=ig_xxx
 *
 * Stages: ramp up to 50 concurrent users over 2 minutes, then ramp down.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'ig_test_key';

export default function () {
  const payload = JSON.stringify({
    aiTool: 'chatgpt',
    score: Math.floor(Math.random() * 100),
    level: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
    entityCount: Math.floor(Math.random() * 10),
    action: 'allow',
  });

  const res = http.post(`${API_URL}/v1/events`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
  });

  check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  sleep(0.1);
}
