/**
 * OpenAPI 3.1 specification for the Iron Gate API.
 * Served at GET /openapi.json, rendered via Swagger UI at GET /docs.
 */

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Iron Gate API',
    version: '0.3.0',
    description: 'Enterprise AI Governance Platform — API for event ingestion, prompt analysis, document scanning, and administration.',
    contact: { email: 'support@irongate.dev' },
  },
  servers: [
    { url: 'https://irongate-api.onrender.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  security: [
    { apiKey: [] },
    { bearerAuth: [] },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        security: [],
        parameters: [
          { name: 'deep', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Include database connectivity check' },
        ],
        responses: {
          200: {
            description: 'Service health status',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/health/metrics': {
      get: {
        summary: 'Operational metrics',
        tags: ['System'],
        security: [],
        responses: {
          200: {
            description: 'Request counts, latency percentiles, per-route stats',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsResponse' } } },
          },
        },
      },
    },
    '/v1/events': {
      get: {
        summary: 'List events',
        tags: ['Events'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'level', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
          { name: 'aiTool', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Paginated list of events' },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Ingest an event',
        tags: ['Events'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EventInput' },
            },
          },
        },
        responses: {
          201: { description: 'Event created' },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/proxy/analyze': {
      post: {
        summary: 'Analyze a prompt for sensitivity',
        tags: ['Proxy'],
        description: 'Runs entity detection, scoring, and pseudonymization on the provided text. Returns a masked prompt and recommended routing.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text', 'aiToolId', 'sessionId'],
                properties: {
                  text: { type: 'string', description: 'The prompt text to analyze' },
                  aiToolId: { type: 'string', description: 'Identifier of the AI tool (e.g., chatgpt, claude)' },
                  sessionId: { type: 'string', description: 'Session identifier for pseudonym map persistence' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Analysis result with masked prompt and routing recommendation' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/documents/scan': {
      post: {
        summary: 'Scan a document for sensitive content',
        tags: ['Documents'],
        description: 'Upload a document (PDF, DOCX, XLSX, TXT, CSV) for entity detection and sensitivity scoring.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Document file to scan' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Scan results with entities, score, and redacted text' },
          400: { description: 'Unsupported file type or file too large' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/api-keys': {
      get: {
        summary: 'List API keys',
        tags: ['API Keys'],
        responses: {
          200: { description: 'List of API keys (full key never exposed)' },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Create an API key',
        tags: ['API Keys'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 100 },
                  scope: { type: 'string', enum: ['read', 'write', 'admin'], default: 'read' },
                  expiresInDays: { type: 'integer', minimum: 1, maximum: 365, description: 'Optional: key auto-expires after N days' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'API key created (full key returned only once)' },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/api-keys/{id}': {
      delete: {
        summary: 'Revoke an API key',
        tags: ['API Keys'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Key revoked' },
          404: { description: 'Key not found' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/billing': {
      get: {
        summary: 'Get billing status',
        tags: ['Billing'],
        responses: {
          200: { description: 'Current subscription, usage, and recent invoices' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/billing/checkout': {
      post: {
        summary: 'Create a Stripe Checkout session',
        tags: ['Billing'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tier'],
                properties: {
                  tier: { type: 'string', enum: ['pro', 'business', 'enterprise'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Checkout session URL' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/user/export': {
      get: {
        summary: 'Export user data (GDPR)',
        tags: ['User'],
        description: 'Returns all data associated with the authenticated user as JSON (GDPR Article 20 data portability).',
        responses: {
          200: { description: 'User data export' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/v1/compliance/status': {
      get: {
        summary: 'Get compliance status',
        tags: ['Compliance'],
        responses: {
          200: { description: 'Compliance status summary for the firm' },
          401: { description: 'Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for extension and programmatic access (ig_... format)',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk JWT token for dashboard authentication',
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          version: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          database: { type: 'string', enum: ['connected', 'disconnected'] },
        },
      },
      MetricsResponse: {
        type: 'object',
        properties: {
          uptimeMs: { type: 'integer' },
          totalRequests: { type: 'integer' },
          totalErrors: { type: 'integer' },
          errorRate: { type: 'number' },
          latency: {
            type: 'object',
            properties: {
              p50: { type: 'integer' },
              p95: { type: 'integer' },
              p99: { type: 'integer' },
            },
          },
        },
      },
      EventInput: {
        type: 'object',
        required: ['aiTool', 'score', 'level', 'entityCount'],
        properties: {
          aiTool: { type: 'string', description: 'AI tool identifier (e.g., chatgpt, claude)' },
          score: { type: 'number', minimum: 0, maximum: 100 },
          level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          entityCount: { type: 'integer', minimum: 0 },
          action: { type: 'string', enum: ['allow', 'block', 'proxy'] },
          entities: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};
