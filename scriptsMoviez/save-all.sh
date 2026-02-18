#!/bin/bash
# Save everything: backup transcripts + regenerate index
# Run: bash scriptsMoviez/save-all.sh

set -e

echo "=== Saving Claude Code Session Data ==="
echo ""

# 1. Backup transcripts
bash "$(dirname "$0")/backup-claude-transcripts.sh"
echo ""

# 2. Regenerate session index
bash "$(dirname "$0")/extract-claude-summaries.sh"
echo ""

echo "=== All saved! ==="
