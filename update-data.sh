#!/bin/bash
# Copy data files from /tmp to public/data if changed
# Expected file formats:
# /tmp/ttfc: first line = median, second line = p90
# /tmp/activechains: first line = percentage, second line = space-separated active chain IDs
# /tmp/tx24h: first line = total transactions, remaining lines = "chainId txCount"
# /tmp/avgblocktime: first line = average block time in seconds
set -e

mkdir -p client/public/data

updated_count=0

copy_if_newer() {
  local src="$1"
  local dst="$2"
  if [ ! -f "$src" ]; then
    echo "Warning: Source file $src does not exist" >&2
    return 1
  fi
  # Copy if destination doesn't exist or source is newer
  if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
    cp "$src" "$dst"
    echo "Updated $dst"
    ((updated_count++)) || true
    return 0
  else
    # No change, silent
    return 0
  fi
}

copy_if_newer /tmp/ttfc client/public/data/ttfc
copy_if_newer /tmp/activechains client/public/data/activechains
copy_if_newer /tmp/tx24h client/public/data/tx24h
copy_if_newer /tmp/avgblocktime client/public/data/avgblocktime

copy_if_newer /tmp/ttfc dist/data/ttfc
copy_if_newer /tmp/activechains dist/data/activechains
copy_if_newer /tmp/tx24h dist/data/tx24h
copy_if_newer /tmp/avgblocktime dist/data/avgblocktime

if [ $updated_count -gt 0 ]; then
  echo "Data files synchronized ($updated_count updated)."
fi
