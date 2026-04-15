/**
 * Deployment Badge — shows the user the locked deployment mode and Tier 2 health.
 *
 * This component is the user-visible source of truth for "is my data leaving my
 * device or not?" In local-only mode, the badge says "Sovereign — local AI" and
 * is the customer's confidence signal that the privacy contract is enforced.
 *
 * Three possible states:
 *   1. Sovereign (local-only) — green, "Local AI active"
 *   2. Hybrid — amber, "Local AI + cloud fallback"
 *   3. Server-only — gray, "Cloud classification"
 *   4. Error — red, "Configuration error — contact IT"
 *
 * The badge polls the worker every 30 seconds for live health status (Ollama
 * reachable? model loaded?) so users can see degradation immediately rather
 * than discovering it on their next prompt.
 */

import React, { useState, useEffect } from 'react';

interface DeploymentStatus {
  deploymentMode: 'local-only' | 'hybrid' | 'server-only';
  initError: string | null;
  config: {
    deploymentMode: string;
    localEndpoint?: string;
    localModel?: string;
    localFormat?: string;
    auditLogDestination?: string;
    firmId?: string;
    killSwitch?: boolean;
  } | null;
  tier2Health: {
    reachable: boolean;
    modelLoaded: boolean;
    latencyMs: number | null;
    endpoint: string;
    model: string;
    format: string;
    error: string | null;
    warmupRequired: boolean;
  } | null;
}

export function DeploymentBadge() {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'IRON_GATE_GET_DEPLOYMENT_STATUS' });
        if (!cancelled && response && !response.error) {
          setStatus(response);
        }
      } catch {
        // Worker may not be ready; retry on next poll
      }
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status) {
    return (
      <div style={badgeStyle('gray')}>
        <span style={dotStyle('gray')} />
        <span>Initializing…</span>
      </div>
    );
  }

  if (status.initError) {
    return (
      <div style={badgeStyle('red')} onClick={() => setExpanded(!expanded)}>
        <span style={dotStyle('red')} />
        <div>
          <div style={{ fontWeight: 600 }}>Deployment error</div>
          {expanded && (
            <div style={detailStyle}>
              {status.initError}
              <div style={{ marginTop: 6, opacity: 0.7 }}>
                Contact your IT administrator. Detection is degraded.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const mode = status.deploymentMode;
  const health = status.tier2Health;
  const cfg = status.config;

  // Local-only: three states
  //   - Healthy              → green "Sovereign mode active"
  //   - Local LLM unreachable → amber "Protection active (pattern-based)"
  //   - (Ollama fails completely) → still amber, Tier 1 pattern detection runs
  //
  // We do NOT go red when the local LLM is offline because the extension is
  // still protecting — pattern-based detection catches the critical cases
  // (SSN, credit card, credentials) via regex even with no LLM. Red was
  // overdramatic and made users think protection had failed entirely.
  if (mode === 'local-only') {
    const healthy = health?.reachable && health?.modelLoaded;
    const color = healthy ? 'green' : 'amber';
    return (
      <div style={badgeStyle(color)} onClick={() => setExpanded(!expanded)}>
        <span style={dotStyle(color)} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {healthy ? '🛡 Sovereign mode active' : '🛡 Protection active (pattern-based)'}
          </div>
          {expanded && (
            <div style={detailStyle}>
              <Row label="Mode" value="Local-only (no cloud calls)" />
              <Row label="Model" value={cfg?.localModel || '(default)'} />
              <Row label="Endpoint" value={health?.endpoint || cfg?.localEndpoint || '—'} />
              <Row label="Status" value={healthy ? 'Reachable + model loaded' : (health?.error || 'Local LLM offline — regex detection still active')} />
              {health?.latencyMs !== null && (
                <Row label="Latency" value={`${health?.latencyMs}ms`} />
              )}
              <Row label="Audit log" value={cfg?.auditLogDestination || 'none'} />
              {!healthy && (
                <div style={{ marginTop: 8, fontSize: 11, opacity: 0.85 }}>
                  To enable context-aware classification: install Ollama + run
                  <code style={{ display: 'block', marginTop: 4, padding: 2, background: 'rgba(0,0,0,0.25)', borderRadius: 3 }}>ollama pull gemma4:e2b</code>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                Your prompts never leave this device. By design and by architecture.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'hybrid') {
    const healthy = health?.reachable && health?.modelLoaded;
    return (
      <div style={badgeStyle('amber')} onClick={() => setExpanded(!expanded)}>
        <span style={dotStyle('amber')} />
        <div>
          <div style={{ fontWeight: 600 }}>Hybrid mode</div>
          {expanded && (
            <div style={detailStyle}>
              <Row label="Mode" value="Local AI preferred, cloud fallback enabled" />
              <Row label="Local LLM" value={healthy ? 'Healthy' : 'Degraded — using cloud fallback'} />
              <Row label="Audit log" value={cfg?.auditLogDestination || 'none'} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Server-only / unmanaged
  return (
    <div style={badgeStyle('gray')} onClick={() => setExpanded(!expanded)}>
      <span style={dotStyle('gray')} />
      <div>
        <div style={{ fontWeight: 600 }}>Cloud classification</div>
        {expanded && (
          <div style={detailStyle}>
            <Row label="Mode" value="Server-only (legacy)" />
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
              Tier 1 detection runs locally. AMBER-zone escalation uses cloud classification.
              Contact IT to upgrade to Sovereign Mode.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0' }}>
      <span style={{ width: 70, opacity: 0.6 }}>{label}</span>
      <span style={{ flex: 1, fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</span>
    </div>
  );
}

function badgeStyle(color: 'green' | 'amber' | 'red' | 'gray'): React.CSSProperties {
  const palette: Record<typeof color, { bg: string; border: string; text: string }> = {
    green: { bg: '#0f1f15', border: '#16a34a', text: '#86efac' },
    amber: { bg: '#1f1909', border: '#d97706', text: '#fcd34d' },
    red:   { bg: '#1f0f0f', border: '#dc2626', text: '#fca5a5' },
    gray:  { bg: '#1e293b', border: '#475569', text: '#cbd5e1' },
  };
  const c = palette[color];
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 12px',
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    color: c.text,
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  };
}

const detailStyle: React.CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid rgba(255,255,255,0.1)',
  fontSize: 11,
  lineHeight: 1.5,
};

function dotStyle(color: 'green' | 'amber' | 'red' | 'gray'): React.CSSProperties {
  const palette: Record<typeof color, string> = {
    green: '#22c55e',
    amber: '#f59e0b',
    red: '#ef4444',
    gray: '#94a3b8',
  };
  return {
    width: 8,
    height: 8,
    borderRadius: 4,
    background: palette[color],
    marginTop: 4,
    flexShrink: 0,
    boxShadow: `0 0 8px ${palette[color]}`,
  };
}
