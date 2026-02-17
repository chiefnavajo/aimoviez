#!/bin/bash
# Backs up all Claude Code conversation transcripts to project directory
# Run: bash scriptsMoviez/backup-claude-transcripts.sh

set -e

BACKUP_DIR="$HOME/Desktop/aimoviez-app/Dokumentacja/claude-transcripts-backup"
SOURCE_DIR="$HOME/.claude/projects/-Users-wojtek-Desktop-aimoviez-app"

echo "=== Claude Code Transcript Backup ==="
echo "Source: $SOURCE_DIR"
echo "Target: $BACKUP_DIR"
echo ""

mkdir -p "$BACKUP_DIR"

# Copy all .jsonl transcript files
count=0
for f in "$SOURCE_DIR"/*.jsonl; do
  [ -e "$f" ] || continue
  cp "$f" "$BACKUP_DIR/"
  count=$((count + 1))
done

echo "Backed up $count transcript files"
echo "Total size: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
echo ""
echo "Done! Transcripts saved to:"
echo "  $BACKUP_DIR"
