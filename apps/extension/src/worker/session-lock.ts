/**
 * Session Lock Manager (DISABLED)
 *
 * Auto-lock functionality has been removed.
 * These exports are kept as no-ops so existing callers don't break.
 */

export async function initSessionLock(): Promise<void> {}
export async function recordActivity(): Promise<void> {}
export async function lockSession(): Promise<void> {}
export async function unlockSession(): Promise<void> {}
export async function isSessionLocked(): Promise<boolean> { return false; }
export async function getLockTimeout(): Promise<number> { return 0; }
export async function setLockTimeout(_minutes: number): Promise<void> {}
export async function handleLockAlarm(): Promise<void> {}
