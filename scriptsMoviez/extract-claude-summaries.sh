#!/bin/bash
# Generates a SESSION-INDEX.md from backed-up Claude Code transcripts
# Shows file size, line count, and first user message per session
# Run: bash scriptsMoviez/extract-claude-summaries.sh

set -e

BACKUP_DIR="$HOME/Desktop/aimoviez-app/Dokumentacja/claude-transcripts-backup"
SUMMARY_FILE="$BACKUP_DIR/SESSION-INDEX.md"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "Error: Backup directory not found. Run backup-claude-transcripts.sh first."
  exit 1
fi

echo "# Claude Code Session Index" > "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "Generated: $(date '+%Y-%m-%d %H:%M')" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

count=0
for f in "$BACKUP_DIR"/*.jsonl; do
  [ -e "$f" ] || continue
  filename=$(basename "$f")
  size=$(du -sh "$f" | cut -f1)
  lines=$(wc -l < "$f" | tr -d ' ')

  # Extract first human message from the transcript
  first_msg=$(python3 -c "
import sys, json
for line in open('$f'):
    try:
        d = json.loads(line)
        if d.get('type') == 'user':
            content = d.get('message', {}).get('content', '')
            if isinstance(content, str):
                print(content[:200].replace('\n', ' '))
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get('type') == 'text':
                        print(item['text'][:200].replace('\n', ' '))
                        break
            break
    except:
        continue
" 2>/dev/null || echo "N/A")

  echo "## $filename" >> "$SUMMARY_FILE"
  echo "- **Size**: $size | **Lines**: $lines" >> "$SUMMARY_FILE"
  echo "- **First message**: $first_msg" >> "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"
  count=$((count + 1))
done

echo "Generated index for $count sessions → $SUMMARY_FILE"
