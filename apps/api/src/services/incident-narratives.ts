import { dbRead } from '../db/client';
import { events, firms, users, departments } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Incident Narrative Generator
//
// Auto-generates a structured incident narrative when a high-risk event
// (score > 80) is detected. Designed for compliance officers, legal teams,
// and auditors who need a human-readable account of what happened.
// ---------------------------------------------------------------------------

export interface IncidentNarrative {
  id: string;
  eventId: string;
  firmId: string;
  generatedAt: string;
  severity: 'high' | 'critical';
  summary: string;
  narrative: string;
  who: { userId: string; firmName: string; department?: string };
  what: { entityTypes: string[]; sensitivityScore: number; sensitivityLevel: string; entityCount: number };
  where: { aiToolId: string; captureMethod: string };
  when: { timestamp: string; humanReadable: string };
  actionTaken: string;
  evidence: { promptHash: string; entityHashes: string[]; chainPosition?: number };
  complianceImpact: string[];
}

/** Entity shape stored in the events.entities JSONB column */
interface StoredEntity {
  type: string;
  textHash: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
  length: number;
}

// ---------------------------------------------------------------------------
// Compliance framework mapping
// ---------------------------------------------------------------------------

const COMPLIANCE_ENTITY_MAP: Record<string, string[]> = {
  SSN: ['CCPA', 'GLBA', 'SOX', 'NYDFS 500'],
  CREDIT_CARD: ['PCI-DSS', 'GLBA'],
  BANK_ACCOUNT: ['GLBA', 'SOX', 'NYDFS 500'],
  HEALTH_RECORD: ['HIPAA'],
  MEDICAL_RECORD: ['HIPAA'],
  PHI: ['HIPAA'],
  DOB: ['CCPA', 'GDPR'],
  PASSPORT: ['GDPR', 'CCPA'],
  DRIVERS_LICENSE: ['CCPA', 'GDPR'],
  EMAIL: ['GDPR', 'CCPA', 'CAN-SPAM'],
  PHONE: ['TCPA', 'GDPR'],
  ADDRESS: ['GDPR', 'CCPA'],
  IP_ADDRESS: ['GDPR'],
  BIOMETRIC: ['BIPA', 'GDPR'],
  GENETIC_DATA: ['GINA', 'GDPR'],
  CASE_NUMBER: ['ABA Model Rules'],
  CLIENT_NAME: ['ABA Model Rules', 'Attorney-Client Privilege'],
  MATTER_NUMBER: ['ABA Model Rules'],
  PRIVILEGED_COMMUNICATION: ['Attorney-Client Privilege'],
};

// ---------------------------------------------------------------------------
// Action label mapping
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  block: 'Blocked the prompt from being sent to the AI tool',
  proxy: 'Pseudonymized sensitive entities before proxying to the AI tool',
  warn: 'Displayed a warning to the user about sensitive content',
  pass: 'Allowed the prompt (below threshold or user-approved)',
  override: 'User overrode the warning and submitted the prompt',
};

// ---------------------------------------------------------------------------
// Human-readable date formatting
// ---------------------------------------------------------------------------

function formatHumanReadable(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  };
  return date.toLocaleString('en-US', options);
}

// ---------------------------------------------------------------------------
// Determine compliance frameworks violated
// ---------------------------------------------------------------------------

function deriveComplianceImpact(entityTypes: string[]): string[] {
  const frameworks = new Set<string>();
  for (const type of entityTypes) {
    const mapped = COMPLIANCE_ENTITY_MAP[type] || COMPLIANCE_ENTITY_MAP[type.toUpperCase()];
    if (mapped) {
      for (const f of mapped) frameworks.add(f);
    }
  }
  return Array.from(frameworks).sort();
}

// ---------------------------------------------------------------------------
// Build the markdown narrative
// ---------------------------------------------------------------------------

function buildMarkdownNarrative(n: Omit<IncidentNarrative, 'narrative'>): string {
  const lines: string[] = [];

  lines.push(`# Incident Narrative: ${n.id}`);
  lines.push('');
  lines.push(`**Severity:** ${n.severity.toUpperCase()}`);
  lines.push(`**Generated:** ${n.generatedAt}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(n.summary);
  lines.push('');

  // Who
  lines.push(`## Who`);
  lines.push('');
  lines.push(`- **User ID:** \`${n.who.userId}\``);
  lines.push(`- **Firm:** ${n.who.firmName}`);
  if (n.who.department) {
    lines.push(`- **Department:** ${n.who.department}`);
  }
  lines.push('');

  // What
  lines.push(`## What`);
  lines.push('');
  lines.push(`- **Entity Types Detected:** ${n.what.entityTypes.join(', ')}`);
  lines.push(`- **Sensitivity Score:** ${n.what.sensitivityScore}/100`);
  lines.push(`- **Sensitivity Level:** ${n.what.sensitivityLevel}`);
  lines.push(`- **Number of Entities:** ${n.what.entityCount}`);
  lines.push('');

  // Where
  lines.push(`## Where`);
  lines.push('');
  lines.push(`- **AI Tool:** ${n.where.aiToolId}`);
  lines.push(`- **Capture Method:** ${n.where.captureMethod}`);
  lines.push('');

  // When
  lines.push(`## When`);
  lines.push('');
  lines.push(`- **Timestamp (ISO 8601):** ${n.when.timestamp}`);
  lines.push(`- **Human-Readable:** ${n.when.humanReadable}`);
  lines.push('');

  // Action Taken
  lines.push(`## Action Taken`);
  lines.push('');
  lines.push(n.actionTaken);
  lines.push('');

  // Evidence
  lines.push(`## Evidence`);
  lines.push('');
  lines.push(`- **Prompt Hash:** \`${n.evidence.promptHash}\``);
  if (n.evidence.entityHashes.length > 0) {
    lines.push(`- **Entity Hashes:**`);
    for (const h of n.evidence.entityHashes) {
      lines.push(`  - \`${h}\``);
    }
  }
  if (n.evidence.chainPosition != null) {
    lines.push(`- **Audit Chain Position:** ${n.evidence.chainPosition}`);
  }
  lines.push('');

  // Compliance Impact
  if (n.complianceImpact.length > 0) {
    lines.push(`## Compliance Impact`);
    lines.push('');
    lines.push(`The following regulatory frameworks may be implicated:`);
    lines.push('');
    for (const f of n.complianceImpact) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by Iron Gate Incident Narrative Engine*`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateNarrative(
  eventId: string,
  firmId: string,
): Promise<IncidentNarrative> {
  // 1. Load the event
  const [event] = await dbRead
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.firmId, firmId)))
    .limit(1);

  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  if (event.sensitivityScore <= 80) {
    throw new Error(
      `Event ${eventId} has sensitivity score ${event.sensitivityScore} (threshold > 80). Narratives are only generated for high-risk events.`,
    );
  }

  // 2. Load the firm
  const [firm] = await dbRead
    .select({ name: firms.name })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    throw new Error(`Firm not found: ${firmId}`);
  }

  // 3. Optionally load user department
  let departmentName: string | undefined;
  const [user] = await dbRead
    .select({ departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, event.userId))
    .limit(1);

  if (user?.departmentId) {
    const [dept] = await dbRead
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, user.departmentId))
      .limit(1);
    departmentName = dept?.name;
  }

  // 4. Parse entities
  const entityList: StoredEntity[] = Array.isArray(event.entities)
    ? (event.entities as StoredEntity[])
    : [];
  const entityTypes = [...new Set(entityList.map((e) => e.type))];
  const entityHashes = entityList.map((e) => e.textHash).filter(Boolean);

  // 5. Determine severity
  const severity: 'high' | 'critical' = event.sensitivityScore >= 86 ? 'critical' : 'high';

  // 6. Derive compliance impact
  const complianceImpact = deriveComplianceImpact(entityTypes);

  // 7. Build action description
  const actionTaken = ACTION_LABELS[event.action] || `Action: ${event.action}`;

  // 8. Timestamps
  const eventDate = event.createdAt ? new Date(event.createdAt) : new Date();
  const timestamp = eventDate.toISOString();
  const humanReadable = formatHumanReadable(eventDate);

  // 9. Generate narrative ID (deterministic from eventId so re-generation is idempotent)
  const narrativeId = crypto
    .createHash('sha256')
    .update(`narrative:${eventId}:${firmId}`)
    .digest('hex')
    .slice(0, 32);

  // 10. Build summary
  const entitySummary =
    entityTypes.length > 0
      ? `${entityTypes.length} entity type(s) detected (${entityTypes.slice(0, 5).join(', ')}${entityTypes.length > 5 ? '...' : ''})`
      : 'No specific entity types recorded';

  const summary = `${severity.toUpperCase()} severity incident: ${entitySummary} with sensitivity score ${event.sensitivityScore}/100 on ${event.aiToolId}. Iron Gate ${actionTaken.toLowerCase()}.`;

  // 11. Assemble (without narrative text — that gets built from this)
  const partial: Omit<IncidentNarrative, 'narrative'> = {
    id: narrativeId,
    eventId,
    firmId,
    generatedAt: new Date().toISOString(),
    severity,
    summary,
    who: {
      userId: event.userId,
      firmName: firm.name,
      ...(departmentName ? { department: departmentName } : {}),
    },
    what: {
      entityTypes,
      sensitivityScore: event.sensitivityScore,
      sensitivityLevel: event.sensitivityLevel,
      entityCount: entityList.length,
    },
    where: {
      aiToolId: event.aiToolId,
      captureMethod: event.captureMethod,
    },
    when: {
      timestamp,
      humanReadable,
    },
    actionTaken,
    evidence: {
      promptHash: event.promptHash,
      entityHashes,
      ...(event.chainPosition != null ? { chainPosition: event.chainPosition } : {}),
    },
    complianceImpact,
  };

  // 12. Build the full markdown narrative
  const narrative = buildMarkdownNarrative(partial);

  return { ...partial, narrative };
}
