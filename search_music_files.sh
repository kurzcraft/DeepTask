#!/usr/bin/env bash
set -u

output="/media/kurz/aleber/vscode/deeptask/music_files_search_results.txt"

: > "$output"

find /home/kurz /media/kurz \
  \( -path /home/kurz/.cache -o -path /home/kurz/.local/share/Trash -o -path /media/kurz/aleber/vscode/deeptask/node_modules \) -prune \
  -o -type f \
  \( \
    -iname '*.mp3' -o -iname '*.flac' -o -iname '*.wav' -o -iname '*.m4a' -o \
    -iname '*.aac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.wma' -o \
    -iname '*.ape' -o -iname '*.alac' -o -iname '*.aiff' -o -iname '*.aif' -o \
    -iname '*.mid' -o -iname '*.midi' -o -iname '*.amr' \
  \) -print 2>/dev/null | sort > "$output"

count=$(wc -l < "$output" | tr -d ' ')
printf 'Found %s music/audio files. Results: %s\n' "$count" "$output"
