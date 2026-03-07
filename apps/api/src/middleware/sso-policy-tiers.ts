/**
 * SSO-Aware Policy Tiers — IG-016
 *
 * Reads the firm's subscription tier from the database and enforces
 * feature availability based on the tier level.
 *
 * Tiers:
 *  - enterprise: Full features, custom policies, unlimited retention
 *  - business:   Standard features, department policies, 90-day retention
 *  - starter:    Basic features, firm-wide policies only, 30-day retention
 */

import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyTier {
  name: 'starter' | 'business' | 'enterprise';
  features: readonly string[];
  maxRetentionDays: number;
  allowDepartmentPolicies: boolean;
  allowCustomDetectors: boolean;
  maxUsers: number;
  allowSIEM: boolean;
  allowMCP: boolean;
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

const TIERS: Record<PolicyTier['name'], PolicyTier> = {
  starter: {
    name: 'starter',
    features: [
      'detection',
      'pseudonymization',
      'audit_trail',
      'basic_compliance',
      'coaching_mode',
    ],
    maxRetentionDays: 30,
    allowDepartmentPolicies: false,
    allowCustomDetectors: false,
    maxUsers: 25,
    allowSIEM: false,
    allowMCP: false,
  },
  business: {
    name: 'business',
    features: [
      'detection',
      'pseudonymization',
      'audit_trail',
      'basic_compliance',
      'coaching_mode',
      'department_policies',
      'advanced_compliance',
      'feedback_flywheel',
      'ocr_detection',
      'api_keys',
    ],
    maxRetentionDays: 90,
    allowDepartmentPolicies: true,
    allowCustomDetectors: false,
    maxUsers: 250,
    allowSIEM: false,
    allowMCP: false,
  },
  enterprise: {
    name: 'enterprise',
    features: [
      'detection',
      'pseudonymization',
      'audit_trail',
      'basic_compliance',
      'coaching_mode',
      'department_policies',
      'advanced_compliance',
      'feedback_flywheel',
      'ocr_detection',
      'api_keys',
      'siem_integration',
      'mcp_proxy',
      'custom_detectors',
      'plugin_sdk',
      'scim_provisioning',
      'mdm_export',
      'incident_narratives',
      'provenance_graph',
      'governance_reports',
      'multimodal_detection',
      'kill_switch',
    ],
    maxRetentionDays: 365,
    allowDepartmentPolicies: true,
    allowCustomDetectors: true,
    maxUsers: Infinity,
    allowSIEM: true,
    allowMCP: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Cache — keyed by firmId, 10-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  tier: PolicyTier;
  expiresAt: number;
}

const tierCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60_000;

export function invalidateTierCache(firmId: string): void {
  tierCache.delete(firmId);
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolvePolicyTier(firmId: string): Promise<PolicyTier> {
  const cached = tierCache.get(firmId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.tier;
  }

  try {
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    const config = (firm?.config as Record<string, unknown>) ?? {};
    const tierName = (config.tier as PolicyTier['name']) ?? 'starter';
    const tier = TIERS[tierName] ?? TIERS.starter;

    tierCache.set(firmId, { tier, expiresAt: Date.now() + CACHE_TTL_MS });
    return tier;
  } catch {
    return TIERS.starter;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function policyTierMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const firmId = c.get('firmId');
    if (!firmId) {
      await next();
      return;
    }

    const tier = await resolvePolicyTier(firmId);
    c.set('policyTier', tier);
    await next();
  });
}

/**
 * Returns middleware that checks if the current tier includes a feature.
 * Usage: app.use('/v1/admin/siem/*', enforceFeature('siem_integration'));
 */
export function enforceFeature(feature: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const tier = c.get('policyTier');

    if (tier && !tier.features.includes(feature)) {
      return c.json(
        {
          error: 'Feature not available',
          message: `The "${feature}" feature requires a higher subscription tier. Current tier: ${tier.name}.`,
          currentTier: tier.name,
          requiredFeature: feature,
        },
        403,
      );
    }

    await next();
  });
}

export { TIERS };
