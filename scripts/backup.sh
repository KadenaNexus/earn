#!/bin/sh
set -eu
umask 077
BACKUP_DIRECTORY=${BACKUP_DIRECTORY:-/backups}
mkdir -p "$BACKUP_DIRECTORY"
backup_name="kadena-earn-$(date -u +%Y%m%dT%H%M%SZ).dump"
backup_temp="$BACKUP_DIRECTORY/$backup_name.partial"
pg_dump --format=custom --no-owner --no-acl --file="$backup_temp"
pg_restore --list "$backup_temp" > /dev/null
mv "$backup_temp" "$BACKUP_DIRECTORY/$backup_name"
if command -v sha256sum > /dev/null 2>&1; then
  (cd "$BACKUP_DIRECTORY" && sha256sum "$backup_name" > "$backup_name.sha256")
else
  (cd "$BACKUP_DIRECTORY" && shasum -a 256 "$backup_name" > "$backup_name.sha256")
fi
find "$BACKUP_DIRECTORY" -name 'kadena-earn-*.dump*' -mtime +14 -type f -exec rm '{}' \;
printf 'Backup verified: %s\n' "$backup_name"
