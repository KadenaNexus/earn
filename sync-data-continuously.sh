#!/bin/bash
# Continuously sync data files from /tmp to public/data every second

set -e

echo "Starting continuous data sync (every second)..."
echo "Press Ctrl+C to stop"

while true; do
  ./update-data.sh > /dev/null 2>&1
  sleep 1
done