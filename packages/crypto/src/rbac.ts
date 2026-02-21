// ============================================================================
// Iron Gate — Role-Based Access Control (RBAC)
// ============================================================================
// Defines the permission matrix for all roles in the Iron Gate platform.
//
// Roles:
//   - admin: Full access to all dashboard, configuration, compliance, and
//            billing features. Typically the firm's designated administrator.
//   - user:  Can use the browser extension and AI tools with protection,
//            view their own detection history, and submit feedback.
//            Cannot access dashboard analytics, admin settings, or billing.
// ============================================================================

// ---------------------------------------------------------------------------
// Role-Permission Matrix
// ---------------------------------------------------------------------------

export const ROLES = {
  admin: {
    // Dashboard & Analytics
    viewDashboard: true,
    viewFirmAnalytics: true,
    viewUserRiskScores: true,

    // User Management
    inviteUsers: true,
    removeUsers: true,
    changeUserRoles: true,

    // Configuration
    setSensitivityThresholds: true,
    addCustomEntityPatterns: true,

    // Integrations
    manageWebhooks: true,
    configureSIEM: true,

    // Compliance & Audit
    viewAuditTrail: true,
    exportComplianceReports: true,

    // Security
    rotateEncryptionKeys: true,
    uploadPublicKey: true,
    requestDataDeletion: true,

    // Billing
    manageBilling: true,
    changeSubscriptionPlan: true,

    // Extension & Tools (admins also have these)
    useExtension: true,
    useAIToolsWithProtection: true,
    viewOwnDetectionHistory: true,
    submitEntityFeedback: true,
  },
  user: {
    // Extension & Tools
    useExtension: true,
    useAIToolsWithProtection: true,
    viewOwnDetectionHistory: true,
    submitEntityFeedback: true,

    // Dashboard & Analytics
    viewDashboard: false,
    viewFirmAnalytics: false,
    viewUserRiskScores: false,

    // User Management
    inviteUsers: false,
    removeUsers: false,
    changeUserRoles: false,

    // Configuration
    setSensitivityThresholds: false,
    addCustomEntityPatterns: false,

    // Integrations
    manageWebhooks: false,
    configureSIEM: false,

    // Compliance & Audit
    viewAuditTrail: false,
    exportComplianceReports: false,

    // Security
    rotateEncryptionKeys: false,
    uploadPublicKey: false,
    requestDataDeletion: false,

    // Billing
    manageBilling: false,
    changeSubscriptionPlan: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available roles in the system */
export type Role = keyof typeof ROLES;

/** All permissions defined across all roles */
export type Permission = keyof typeof ROLES['admin'];

// ---------------------------------------------------------------------------
// Permission Checks
// ---------------------------------------------------------------------------

/**
 * Check whether a given role has a specific permission.
 *
 * @param role - The role to check
 * @param permission - The permission to verify
 * @returns true if the role has the permission, false otherwise
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return !!ROLES[role]?.[permission];
}

/**
 * Assert that a role has a specific permission, throwing if it does not.
 * Use this as a guard at the start of protected route handlers.
 *
 * @param role - The role to check
 * @param permission - The required permission
 * @throws Error if the role lacks the permission
 */
export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role '${role}' lacks permission '${permission}'`);
  }
}
