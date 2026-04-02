#!/bin/bash
cd "$(dirname "$0")/../.." || exit 0
lang=$(bun src/cli.ts config language 2>/dev/null)
if [ "$lang" = "(not set)" ] || [ -z "$lang" ]; then
  echo "Language is not configured. Ask the user what language they prefer for article summaries and digests, then run: bun src/cli.ts config language <code> (e.g. ja, en, zh, ko)"
fi
