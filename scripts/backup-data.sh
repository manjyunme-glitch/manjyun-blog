#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-data.sh --base-dir PATH [--output FILE]
                         [--container NAME | --confirm-stopped] [--dry-run]

Creates a private tar.gz archive containing the complete data/ and uploads/
directories. The application must be stopped so the SQLite database, WAL and
SHM files are captured as one consistent offline set.

Options:
  --base-dir PATH       Host directory containing data/ and uploads/.
                        Defaults to STACK_BASE_DIR when set.
  --output FILE         New archive path. Existing files are never overwritten.
                        Defaults to ./backups/manjyun-blog-TIMESTAMP.tar.gz.
  --container NAME      Container whose stopped state should be verified.
                        Defaults to CONTAINER_NAME_PREFIX-app (mblog-app).
  --confirm-stopped     Explicitly confirm the application is stopped when
                        Docker cannot verify the expected container.
  --dry-run             Validate inputs and print the plan without writing.
  -h, --help            Show this help.
EOF
}

fail() {
  printf '%s\n' "backup: $*" >&2
  exit 1
}

base_dir=${STACK_BASE_DIR:-}
output=
container=${CONTAINER_NAME_PREFIX:-mblog}-app
confirm_stopped=0
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-dir)
      [ "$#" -ge 2 ] || fail "--base-dir requires a value"
      base_dir=$2
      shift 2
      ;;
    --output)
      [ "$#" -ge 2 ] || fail "--output requires a value"
      output=$2
      shift 2
      ;;
    --container)
      [ "$#" -ge 2 ] || fail "--container requires a value"
      container=$2
      shift 2
      ;;
    --confirm-stopped)
      confirm_stopped=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "$base_dir" ] || fail "set STACK_BASE_DIR or pass --base-dir"
case "$base_dir" in
  /*) ;;
  *) fail "--base-dir must be an absolute host path" ;;
esac
[ -d "$base_dir" ] || fail "base directory does not exist: $base_dir"
base_dir=$(CDPATH= cd -P "$base_dir" && pwd)
[ "$base_dir" != "/" ] || fail "refusing to use the filesystem root"
[ -d "$base_dir/data" ] && [ ! -L "$base_dir/data" ] ||
  fail "expected a real data/ directory below $base_dir"
[ -d "$base_dir/uploads" ] && [ ! -L "$base_dir/uploads" ] ||
  fail "expected a real uploads/ directory below $base_dir"
if find "$base_dir/data" "$base_dir/uploads" \
  ! -type d ! -type f -print | grep -q .; then
  fail "data/ and uploads/ must not contain symbolic links or special files"
fi

if [ "$confirm_stopped" -ne 1 ]; then
  command -v docker >/dev/null 2>&1 ||
    fail "Docker is unavailable; stop the application and pass --confirm-stopped"
  running=$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null) ||
    fail "cannot verify container '$container'; pass its name or use --confirm-stopped after stopping the application"
  [ "$running" != "true" ] ||
    fail "container '$container' is running; stop it before taking an offline backup"
fi

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
if [ -z "$output" ]; then
  output=$PWD/backups/manjyun-blog-$timestamp.tar.gz
fi
case "$output" in
  /*) ;;
  *) output=$PWD/$output ;;
esac

printf '%s\n' "Backup source : $base_dir/{data,uploads}"
printf '%s\n' "Archive target: $output"
printf '%s\n' "Stopped state : confirmed"
if [ "$dry_run" -eq 1 ]; then
  printf '%s\n' "Dry run complete; no files were written."
  exit 0
fi

output_parent=$(dirname "$output")
output_name=$(basename "$output")
case "$output_name" in
  ""|"."|"..") fail "invalid output filename" ;;
esac
mkdir -p "$output_parent"
output_parent=$(CDPATH= cd -P "$output_parent" && pwd)
output=$output_parent/$output_name
case "$output" in
  "$base_dir/data"|"$base_dir/data/"*|"$base_dir/uploads"|"$base_dir/uploads/"*)
    fail "the archive must be stored outside data/ and uploads/"
    ;;
esac
[ ! -e "$output" ] || fail "refusing to overwrite existing archive: $output"

umask 077
temporary_archive=$output_parent/.manjyun-backup-$timestamp-$$.tmp
cleanup() {
  rm -f "$temporary_archive"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

tar -czf "$temporary_archive" -C "$base_dir" data uploads
tar -tzf "$temporary_archive" >/dev/null

# Prefer atomic hard-link publication. NAS filesystems that do not support hard
# links fall back to a noclobber-created copy; neither path overwrites a name
# that appeared after the earlier existence check.
if ! ln "$temporary_archive" "$output" 2>/dev/null; then
  (set -C; cat "$temporary_archive" >"$output") 2>/dev/null ||
    fail "could not publish archive without overwriting an existing file"
fi
tar -tzf "$output" >/dev/null ||
  fail "published archive did not pass its final integrity check"
rm -f "$temporary_archive"
chmod 600 "$output" 2>/dev/null || true
trap - EXIT HUP INT TERM

printf '%s\n' "Backup created: $output"
