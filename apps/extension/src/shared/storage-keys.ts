/**
 * Chrome storage key constants used throughout the extension.
 * Centralizes all keys to avoid typos and make refactoring easier.
 */

// Onboarding
export const ONBOARDING_COMPLETED = 'onboarding_completed';
export const SELECTED_INDUSTRIES = 'selected_industries';

// User identity
export const USER_EMAIL = 'user_email';
export const DEVICE_ID = 'device_id';
export const FIRM_ID = 'firm_id';
export const FIRM_CODE = 'firm_code';
export const FIRM_NAME = 'firm_name';

// Subscription / Trial
export const SUBSCRIPTION_TIER = 'subscription_tier';
export const SUBSCRIPTION_CACHED_AT = 'subscription_cached_at';
export const TRIAL_START_DATE = 'trial_start_date';
export const TRIAL_ENDS_AT = 'trial_ends_at';

// Stats
export const WEEKLY_SCAN_COUNT = 'weekly_scan_count';
export const TOTAL_ENTITIES_DETECTED = 'total_entities_detected';

// Notifications
export const LAST_NOTIFICATION_DAY = 'last_notification_day';

export type SubscriptionTier = 'basic' | 'pro' | 'team' | 'enterprise';
