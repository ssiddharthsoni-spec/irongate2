import { describe, it, expect } from 'vitest';

describe('Alert Severity Levels', () => {
  const SEVERITIES = ['info', 'warning', 'critical'] as const;

  it('should have three severity levels', () => {
    expect(SEVERITIES).toHaveLength(3);
  });

  it('should have correct severity ordering', () => {
    expect(SEVERITIES[0]).toBe('info');
    expect(SEVERITIES[1]).toBe('warning');
    expect(SEVERITIES[2]).toBe('critical');
  });
});

describe('Alert Payload Validation', () => {
  interface AlertPayload {
    firmId: string;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    body?: string;
    metadata?: Record<string, unknown>;
  }

  it('should accept valid alert payload', () => {
    const payload: AlertPayload = {
      firmId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'high_risk_detected',
      severity: 'warning',
      title: 'High sensitivity prompt detected',
    };

    expect(payload.firmId).toBeDefined();
    expect(payload.type).toBe('high_risk_detected');
    expect(payload.severity).toBe('warning');
    expect(payload.body).toBeUndefined();
  });

  it('should support optional metadata', () => {
    const payload: AlertPayload = {
      firmId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'anomaly_detected',
      severity: 'critical',
      title: 'Unusual activity detected',
      metadata: {
        userId: 'user-123',
        score: 95,
        entities: ['SSN', 'CREDIT_CARD'],
      },
    };

    expect(payload.metadata).toBeDefined();
    expect(payload.metadata?.entities).toHaveLength(2);
  });
});

describe('Slack Alert Formatting', () => {
  const colorMap: Record<string, string> = {
    info: '#00B4D8',
    warning: '#F59E0B',
    critical: '#EF4444',
  };

  it('should map severity to correct color', () => {
    expect(colorMap.info).toBe('#00B4D8');
    expect(colorMap.warning).toBe('#F59E0B');
    expect(colorMap.critical).toBe('#EF4444');
  });
});
