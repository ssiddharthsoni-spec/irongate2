export interface GatewayConfig {
  port: number;
  firmId: string;
  databaseUrl: string;
  upstreams: {
    openai: string;
    anthropic: string;
  };
  thresholds: {
    pseudonymize: number;
    block: number;
  };
  failOpen: boolean;
}

export function loadConfig(): GatewayConfig {
  const firmId = process.env.IRON_GATE_FIRM_ID;
  if (!firmId) {
    console.error('[Gateway] IRON_GATE_FIRM_ID is required');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[Gateway] DATABASE_URL is required');
    process.exit(1);
  }

  return {
    port: parseInt(process.env.GATEWAY_PORT || '8443'),
    firmId,
    databaseUrl,
    upstreams: {
      openai: process.env.OPENAI_UPSTREAM_URL || 'https://api.openai.com',
      anthropic: process.env.ANTHROPIC_UPSTREAM_URL || 'https://api.anthropic.com',
    },
    thresholds: {
      pseudonymize: parseInt(process.env.GATEWAY_PSEUDONYMIZE_THRESHOLD || '25'),
      block: parseInt(process.env.GATEWAY_BLOCK_THRESHOLD || '60'),
    },
    failOpen: process.env.GATEWAY_FAIL_OPEN !== 'false',
  };
}
