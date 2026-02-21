/**
 * Iron Gate — Database Seed Script
 * Creates initial firm, user, and sample events for development.
 *
 * Run: bun run src/db/seed.ts
 */

import { db } from './client';
import {
  firms,
  users,
  events,
  clientMatters,
  weightOverrides,
  entityCoOccurrences,
  inferredEntities,
  sensitivityPatterns,
  firmPlugins,
  webhookSubscriptions,
} from './schema';

async function seed() {
  console.log('[Seed] Starting...\n');

  // 1. Create dev firm
  const [firm] = await db
    .insert(firms)
    .values({
      name: 'Iron Gate Dev',
      domain: 'irongate.dev',
      mode: 'audit',
      config: {
        thresholds: { passthrough: 30, cloudMasked: 70 },
        defaultCloudProvider: 'openai',
        pseudonymTtlMinutes: 60,
      },
      encryptionSalt: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', // dev salt
    })
    .returning();

  console.log(`[Seed] Created firm: ${firm.name} (${firm.id})`);

  // 2. Create dev user
  const [user] = await db
    .insert(users)
    .values({
      firmId: firm.id,
      clerkId: 'dev-clerk-id',
      email: 'dev@irongate.dev',
      displayName: 'Dev User',
      role: 'admin',
    })
    .returning();

  console.log(`[Seed] Created user: ${user.email} (${user.id})`);

  // 3. Create sample events across different AI tools and sensitivity levels
  const sampleEvents = [
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'chatgpt',
      promptHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      promptLength: 245,
      sensitivityScore: 15,
      sensitivityLevel: 'low' as const,
      entities: [],
      action: 'pass' as const,
      captureMethod: 'dom',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'chatgpt',
      promptHash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
      promptLength: 512,
      sensitivityScore: 42,
      sensitivityLevel: 'medium' as const,
      entities: [
        { type: 'PERSON', text: 'John Smith', confidence: 0.95 },
        { type: 'ORGANIZATION', text: 'Acme Corp', confidence: 0.88 },
      ],
      action: 'warn' as const,
      captureMethod: 'submit',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'claude',
      promptHash: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      promptLength: 1024,
      sensitivityScore: 68,
      sensitivityLevel: 'high' as const,
      entities: [
        { type: 'PERSON', text: 'Jane Doe', confidence: 0.92 },
        { type: 'SSN', text: '***-**-1234', confidence: 0.99 },
        { type: 'MONETARY_AMOUNT', text: '$2.5M', confidence: 0.85 },
      ],
      action: 'proxy' as const,
      captureMethod: 'fetch',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'chatgpt',
      promptHash: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
      promptLength: 2048,
      sensitivityScore: 89,
      sensitivityLevel: 'critical' as const,
      entities: [
        { type: 'PERSON', text: 'Robert Chen', confidence: 0.97 },
        { type: 'CREDIT_CARD', text: '****-****-****-4321', confidence: 0.99 },
        { type: 'EMAIL', text: 'r.chen@example.com', confidence: 0.98 },
        { type: 'MATTER_NUMBER', text: 'M-2024-001', confidence: 0.90 },
      ],
      action: 'block' as const,
      captureMethod: 'dom',
      metadata: { browser: 'Chrome 120', blocked: true },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'gemini',
      promptHash: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
      promptLength: 180,
      sensitivityScore: 8,
      sensitivityLevel: 'low' as const,
      entities: [],
      action: 'pass' as const,
      captureMethod: 'submit',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'copilot',
      promptHash: 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
      promptLength: 350,
      sensitivityScore: 55,
      sensitivityLevel: 'medium' as const,
      entities: [
        { type: 'ORGANIZATION', text: 'TechStartup Inc', confidence: 0.80 },
        { type: 'IP_ADDRESS', text: '10.0.1.55', confidence: 0.95 },
      ],
      action: 'warn' as const,
      captureMethod: 'fetch',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'claude',
      promptHash: 'a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8',
      promptLength: 780,
      sensitivityScore: 72,
      sensitivityLevel: 'high' as const,
      entities: [
        { type: 'PERSON', text: 'Sarah Williams', confidence: 0.93 },
        { type: 'PHONE_NUMBER', text: '(555) 123-4567', confidence: 0.97 },
        { type: 'DEAL_CODENAME', text: 'Project Phoenix', confidence: 0.88 },
      ],
      action: 'proxy' as const,
      captureMethod: 'dom',
      metadata: { browser: 'Chrome 120' },
    },
    {
      firmId: firm.id,
      userId: user.id,
      aiToolId: 'chatgpt',
      promptHash: 'b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9',
      promptLength: 420,
      sensitivityScore: 35,
      sensitivityLevel: 'medium' as const,
      entities: [
        { type: 'ORGANIZATION', text: 'Global Finance Ltd', confidence: 0.85 },
      ],
      action: 'pass' as const,
      captureMethod: 'fetch',
      metadata: { browser: 'Chrome 120' },
    },
  ];

  const insertedEvents = await db.insert(events).values(sampleEvents).returning({ id: events.id });
  console.log(`[Seed] Created ${insertedEvents.length} sample events`);

  // 4. Create a sample client matter
  const [matter] = await db
    .insert(clientMatters)
    .values({
      firmId: firm.id,
      clientName: 'Acme Corporation',
      aliases: ['Acme Corp', 'ACME', 'Acme Inc.'],
      matterNumber: 'M-2024-001',
      matterDescription: 'Merger & Acquisition advisory — confidential',
      parties: ['Acme Corporation', 'TechStartup Inc', 'Global Finance Ltd'],
      sensitivityLevel: 'high',
      isActive: true,
    })
    .returning();

  console.log(`[Seed] Created client matter: ${matter.clientName} (${matter.matterNumber})`);

  // 5. Create weight overrides (Data Flywheel)
  const insertedWeights = await db
    .insert(weightOverrides)
    .values([
      {
        firmId: firm.id,
        entityType: 'SSN',
        weightMultiplier: 1.45,
        sampleCount: 120,
        falsePositiveRate: 0.03,
      },
      {
        firmId: firm.id,
        entityType: 'PRIVILEGE_MARKER',
        weightMultiplier: 1.50,
        sampleCount: 85,
        falsePositiveRate: 0.08,
      },
      {
        firmId: firm.id,
        entityType: 'API_KEY',
        weightMultiplier: 1.55,
        sampleCount: 42,
        falsePositiveRate: 0.02,
      },
    ])
    .returning({ id: weightOverrides.id });

  console.log(`[Seed] Created ${insertedWeights.length} weight overrides`);

  // 6. Create entity co-occurrences (Sensitivity Graph)
  const insertedCoOccurrences = await db
    .insert(entityCoOccurrences)
    .values([
      {
        firmId: firm.id,
        entityAHash: 'aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44',
        entityAType: 'PERSON',
        entityBHash: 'bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55',
        entityBType: 'SSN',
        coOccurrenceCount: 34,
        avgContextScore: 78.5,
      },
      {
        firmId: firm.id,
        entityAHash: 'cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66',
        entityAType: 'PERSON',
        entityBHash: 'dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11',
        entityBType: 'MATTER_NUMBER',
        coOccurrenceCount: 21,
        avgContextScore: 62.3,
      },
      {
        firmId: firm.id,
        entityAHash: 'ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22',
        entityAType: 'ORGANIZATION',
        entityBHash: 'ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33',
        entityBType: 'MONETARY_AMOUNT',
        coOccurrenceCount: 15,
        avgContextScore: 55.0,
      },
      {
        firmId: firm.id,
        entityAHash: '1122334455667788990011223344556677889900112233445566778899001122',
        entityAType: 'PERSON',
        entityBHash: '2233445566778899001122334455667788990011223344556677889900112233',
        entityBType: 'EMAIL',
        coOccurrenceCount: 47,
        avgContextScore: 41.2,
      },
      {
        firmId: firm.id,
        entityAHash: '3344556677889900112233445566778899001122334455667788990011223344',
        entityAType: 'CREDIT_CARD',
        entityBHash: '4455667788990011223344556677889900112233445566778899001122334455',
        entityBType: 'PERSON',
        coOccurrenceCount: 9,
        avgContextScore: 88.1,
      },
    ])
    .returning({ id: entityCoOccurrences.id });

  console.log(`[Seed] Created ${insertedCoOccurrences.length} entity co-occurrences`);

  // 7. Create inferred entities (Inference Engine)
  const insertedInferred = await db
    .insert(inferredEntities)
    .values([
      {
        firmId: firm.id,
        textHash: 'aabb001122334455aabb001122334455aabb001122334455aabb001122334455',
        inferredType: 'DEAL_CODENAME',
        confidence: 0.92,
        evidenceCount: 8,
        status: 'confirmed',
        confirmedBy: user.id,
        promotedAt: new Date(),
      },
      {
        firmId: firm.id,
        textHash: 'bbcc112233445566bbcc112233445566bbcc112233445566bbcc112233445566',
        inferredType: 'MATTER_NUMBER',
        confidence: 0.74,
        evidenceCount: 3,
        status: 'pending',
      },
      {
        firmId: firm.id,
        textHash: 'ccdd223344556677ccdd223344556677ccdd223344556677ccdd223344556677',
        inferredType: 'PRIVILEGE_MARKER',
        confidence: 0.41,
        evidenceCount: 1,
        status: 'rejected',
      },
    ])
    .returning({ id: inferredEntities.id });

  console.log(`[Seed] Created ${insertedInferred.length} inferred entities`);

  // 8. Create sensitivity patterns
  const insertedPatterns = await db
    .insert(sensitivityPatterns)
    .values([
      {
        firmId: firm.id,
        patternHash: 'ppaa112233445566ppaa112233445566ppaa112233445566ppaa112233445566',
        entityTypes: ['PERSON', 'SSN', 'MONETARY_AMOUNT'],
        triggerCount: 12,
        avgScore: 81.5,
        isGlobal: false,
      },
      {
        firmId: firm.id,
        patternHash: 'ppbb223344556677ppbb223344556677ppbb223344556677ppbb223344556677',
        entityTypes: ['ORGANIZATION', 'CREDIT_CARD', 'EMAIL'],
        triggerCount: 7,
        avgScore: 72.0,
        isGlobal: true,
      },
    ])
    .returning({ id: sensitivityPatterns.id });

  console.log(`[Seed] Created ${insertedPatterns.length} sensitivity patterns`);

  // 9. Create a sample firm plugin
  const [plugin] = await db
    .insert(firmPlugins)
    .values({
      firmId: firm.id,
      name: 'Legal Privilege Detector',
      description: 'Detects attorney-client privilege markers in prompts',
      version: '1.0.0',
      code: `export function detect(text) {
  const markers = ['privileged', 'attorney-client', 'work product', 'confidential communication'];
  const found = markers.filter(m => text.toLowerCase().includes(m));
  return found.map(m => ({ type: 'PRIVILEGE_MARKER', text: m, confidence: 0.85 }));
}`,
      entityTypes: ['PRIVILEGE_MARKER'],
      isActive: true,
      hitCount: 23,
      falsePositiveRate: 0.05,
      createdBy: user.id,
    })
    .returning();

  console.log(`[Seed] Created firm plugin: ${plugin.name} (${plugin.id})`);

  // 10. Create a sample webhook subscription
  const [webhook] = await db
    .insert(webhookSubscriptions)
    .values({
      firmId: firm.id,
      url: 'https://hooks.irongate.dev/audit-events',
      eventTypes: ['event.created', 'event.blocked', 'sensitivity.critical'],
      secret: 'whsec_dev_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      isActive: true,
    })
    .returning();

  console.log(`[Seed] Created webhook subscription: ${webhook.url} (${webhook.id})`);

  // Print summary
  console.log('\n========================================');
  console.log('  SEED COMPLETE');
  console.log('========================================');
  console.log(`  Firm ID:          ${firm.id}`);
  console.log(`  User ID:          ${user.id}`);
  console.log(`  Events:           ${insertedEvents.length}`);
  console.log(`  Matters:          1`);
  console.log(`  Weight Overrides: ${insertedWeights.length}`);
  console.log(`  Co-occurrences:   ${insertedCoOccurrences.length}`);
  console.log(`  Inferred:         ${insertedInferred.length}`);
  console.log(`  Patterns:         ${insertedPatterns.length}`);
  console.log(`  Plugins:          1`);
  console.log(`  Webhooks:         1`);
  console.log('========================================');
  console.log(`\n  Add this to your .env file:`);
  console.log(`  DEFAULT_FIRM_ID=${firm.id}\n`);

  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
