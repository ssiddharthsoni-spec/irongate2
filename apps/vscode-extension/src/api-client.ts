/**
 * VS Code API Client — sends events to the same Iron Gate backend.
 * The AI tool identifier changes from "chatgpt" to "copilot-vscode" or "cursor"
 * but everything else is the same.
 */

interface ApiConfig {
  apiKey: string;
  firmId: string;
  baseUrl: string;
}

interface EventPayload {
  aiToolId: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: string;
  entities: Array<{ type: string; length: number; confidence: number }>;
  action: string;
  captureMethod: string;
}

export class ApiClient {
  private config: ApiConfig;
  private eventQueue: EventPayload[] = [];
  private flushTimeout: NodeJS.Timeout | undefined;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  updateConfig(config: Partial<ApiConfig>): void {
    Object.assign(this.config, config);
  }

  async sendEvent(event: EventPayload): Promise<void> {
    this.eventQueue.push(event);

    // Batch events and flush every 5 seconds
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), 5000);
    }
  }

  async flush(): Promise<void> {
    this.flushTimeout = undefined;
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0, this.eventQueue.length);

    if (!this.config.apiKey || !this.config.firmId) return;

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-Firm-ID': this.config.firmId,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // Re-queue events on failure
        this.eventQueue.unshift(...events);
      }
    } catch {
      // Re-queue on network error
      this.eventQueue.unshift(...events);
    }
  }

  async sendHeartbeat(aiToolId: string, mode: string): Promise<void> {
    if (!this.config.apiKey || !this.config.firmId) return;

    try {
      await fetch(`${this.config.baseUrl}/v1/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-Firm-ID': this.config.firmId,
        },
        body: JSON.stringify({
          extensionVersion: '0.1.0',
          activePlatform: aiToolId,
          mode,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Non-critical
    }
  }
}
