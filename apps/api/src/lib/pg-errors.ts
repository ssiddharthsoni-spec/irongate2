// PostgreSQL error code helpers for optimistic concurrency control.

/**
 * Check if an error is a PostgreSQL unique_violation (code 23505).
 * Used by the audit chain's optimistic retry loop to detect
 * concurrent inserts at the same chain position.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
