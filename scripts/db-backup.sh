#!/bin/bash
# Iron Gate — Manual Database Backup
#
# Usage:
#   ./scripts/db-backup.sh
#
# Requires: pg_dump, gzip, DATABASE_URL env var
#
# Note: Supabase Pro plan includes daily automated backups with PITR.
# This script is for manual/ad-hoc backups (e.g., before migrations).

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set"
  echo "Usage: DATABASE_URL=postgresql://... ./scripts/db-backup.sh"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_FILE="${BACKUP_DIR}/irongate_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Starting backup..."
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup complete: $BACKUP_FILE ($SIZE)"
echo ""
echo "To restore:"
echo "  gunzip -c $BACKUP_FILE | psql \$DATABASE_URL"
