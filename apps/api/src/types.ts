import { Hono } from 'hono';
import type { DepartmentPolicy } from './middleware/department-policy';
import type { PolicyTier } from './middleware/sso-policy-tiers';

// Declare custom variables available on the Hono context
export type AppVariables = {
  userId: string;
  clerkId: string;
  firmId: string;
  userRole: 'admin' | 'user';
  departmentId?: string;
  departmentPolicy?: DepartmentPolicy;
  policyTier?: PolicyTier;
};

export type AppEnv = {
  Variables: AppVariables;
};
