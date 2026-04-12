import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { enrollmentCodes } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requirePerm } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { auditLog } from '../db/schema';
import type { AppEnv } from '../types';
import type { Context } from 'hono';

export const enrollmentRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Audit logging helper (mirrors admin.ts pattern)
// ---------------------------------------------------------------------------
async function logAdminAction(
  c: Context<AppEnv>,
  action: string,
  resourceType: string,
  opts?: {
    resourceId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  const firmId = c.get('firmId');
  const actorId = c.get('userId');
  const ipAddress = c.req.header('cf-connecting-ip')
    || c.req.header('x-render-client-ip')
    || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
    || null;

  try {
    await db.insert(auditLog)
      .values({
        firmId,
        actorId,
        actorEmail: null,
        action,
        resourceType,
        resourceId: opts?.resourceId || null,
        oldValue: opts?.oldValue != null ? opts.oldValue : null,
        newValue: opts?.newValue != null ? opts.newValue : null,
        ipAddress,
        userAgent: c.req.header('user-agent') || null,
      });
  } catch (err) {
    logger.warn('Audit log insert failed', { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Helper: generate enrollment code in XXXX-XXXX format
// 4 uppercase letters + hyphen + 4 alphanumeric
// ---------------------------------------------------------------------------
function generateEnrollmentCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  const bytes = crypto.randomBytes(8);
  let code = '';

  // First 4 chars: uppercase letters
  for (let i = 0; i < 4; i++) {
    code += letters[bytes[i] % letters.length];
  }

  code += '-';

  // Last 4 chars: alphanumeric
  for (let i = 4; i < 8; i++) {
    code += alphanumeric[bytes[i] % alphanumeric.length];
  }

  return code;
}

// ---------------------------------------------------------------------------
// POST / — Create enrollment code
// ---------------------------------------------------------------------------
enrollmentRoutes.post('/', requirePerm('setSensitivityThresholds'), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const schema = z.object({
    label: z.string().max(100).optional(),
    maxUses: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.errors }, 400);
  }
  const parsed = result.data;

  const firmId = c.get('firmId');
  const userId = c.get('userId');

  try {
    const code = generateEnrollmentCode();

    const [created] = await db
      .insert(enrollmentCodes)
      .values({
        firmId,
        code,
        label: parsed.label || null,
        maxUses: parsed.maxUses || null,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        createdBy: userId,
      })
      .returning();

    await logAdminAction(c, 'create_enrollment_code', 'enrollment_code', {
      resourceId: created.id,
      newValue: { code, label: parsed.label, maxUses: parsed.maxUses },
    });

    return c.json(created, 201);
  } catch (err) {
    logger.error('Failed to create enrollment code', {
      error: err instanceof Error ? err.message : String(err),
      firmId,
    });
    return c.json({ error: 'Failed to create enrollment code' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET / — List all enrollment codes for this firm
// ---------------------------------------------------------------------------
enrollmentRoutes.get('/', requirePerm('viewFirmAnalytics'), async (c) => {
  const firmId = c.get('firmId');

  try {
    const codes = await db
      .select()
      .from(enrollmentCodes)
      .where(eq(enrollmentCodes.firmId, firmId))
      .orderBy(desc(enrollmentCodes.createdAt));

    return c.json(codes);
  } catch (err) {
    logger.error('Failed to list enrollment codes', {
      error: err instanceof Error ? err.message : String(err),
      firmId,
    });
    return c.json({ error: 'Failed to list enrollment codes' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — Revoke a code (soft delete)
// ---------------------------------------------------------------------------
enrollmentRoutes.delete('/:id', requirePerm('setSensitivityThresholds'), async (c) => {
  const codeId = c.req.param('id');
  const firmId = c.get('firmId');

  try {
    const [updated] = await db
      .update(enrollmentCodes)
      .set({ revoked: true })
      .where(and(
        eq(enrollmentCodes.id, codeId),
        eq(enrollmentCodes.firmId, firmId),
      ))
      .returning();

    if (!updated) {
      return c.json({ error: 'Enrollment code not found' }, 404);
    }

    await logAdminAction(c, 'revoke_enrollment_code', 'enrollment_code', {
      resourceId: codeId,
    });

    return c.json({ success: true });
  } catch (err) {
    logger.error('Failed to revoke enrollment code', {
      error: err instanceof Error ? err.message : String(err),
      firmId,
    });
    return c.json({ error: 'Failed to revoke enrollment code' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/usage — Get usage details for a code
// ---------------------------------------------------------------------------
enrollmentRoutes.get('/:id/usage', requirePerm('viewFirmAnalytics'), async (c) => {
  const codeId = c.req.param('id');
  const firmId = c.get('firmId');

  try {
    const [code] = await db
      .select()
      .from(enrollmentCodes)
      .where(and(
        eq(enrollmentCodes.id, codeId),
        eq(enrollmentCodes.firmId, firmId),
      ))
      .limit(1);

    if (!code) {
      return c.json({ error: 'Enrollment code not found' }, 404);
    }

    return c.json(code);
  } catch (err) {
    logger.error('Failed to get enrollment code usage', {
      error: err instanceof Error ? err.message : String(err),
      firmId,
    });
    return c.json({ error: 'Failed to get enrollment code usage' }, 500);
  }
});
