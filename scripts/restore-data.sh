#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage:
  scripts/restore-data.sh --archive FILE --base-dir PATH
                          [--container NAME | --confirm-stopped]
                          [--rollback-dir PATH] [--dry-run] [--yes]

Validates and stages an offline backup before replacing data/ and uploads/.
Without --yes, restore always refuses to overwrite the current installation.
When current data exists, a separate pre-restore rollback archive is mandatory
and is created automatically before the directory swap.

Options:
  --archive FILE        Archive created by backup-data.sh.
  --base-dir PATH       Destination host directory (or STACK_BASE_DIR).
  --container NAME      Container whose stopped state should be verified.
                        Defaults to CONTAINER_NAME_PREFIX-app (mblog-app).
  --confirm-stopped     Explicitly confirm the application is stopped when
                        Docker cannot verify the expected container.
  --rollback-dir PATH   Existing/new directory for the pre-restore backup.
                        Defaults beside the destination base directory.
  --dry-run             Fully validate archive and paths without writing.
  --yes                 Authorize replacement after validation and rollback.
  -h, --help            Show this help.
EOF
}

fail() {
  printf '%s\n' "restore: $*" >&2
  exit 1
}

archive=
base_dir=${STACK_BASE_DIR:-}
container=${CONTAINER_NAME_PREFIX:-mblog}-app
rollback_dir=
confirm_stopped=0
dry_run=0
approved=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --archive)
      [ "$#" -ge 2 ] || fail "--archive requires a value"
      archive=$2
      shift 2
      ;;
    --base-dir)
      [ "$#" -ge 2 ] || fail "--base-dir requires a value"
      base_dir=$2
      shift 2
      ;;
    --container)
      [ "$#" -ge 2 ] || fail "--container requires a value"
      container=$2
      shift 2
      ;;
    --rollback-dir)
      [ "$#" -ge 2 ] || fail "--rollback-dir requires a value"
      rollback_dir=$2
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
    --yes)
      approved=1
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

[ -n "$archive" ] || fail "--archive is required"
[ -n "$base_dir" ] || fail "set STACK_BASE_DIR or pass --base-dir"
case "$archive" in
  /*) ;;
  *) archive=$PWD/$archive ;;
esac
[ -f "$archive" ] && [ ! -L "$archive" ] || fail "archive is not a regular file: $archive"
archive_parent=$(CDPATH= cd -P "$(dirname "$archive")" && pwd)
archive=$archive_parent/$(basename "$archive")

case "$base_dir" in
  /*) ;;
  *) fail "--base-dir must be an absolute host path" ;;
esac
[ -d "$base_dir" ] || fail "destination base directory must already exist: $base_dir"
base_dir=$(CDPATH= cd -P "$base_dir" && pwd)
[ "$base_dir" != "/" ] || fail "refusing to restore into the filesystem root"
base_parent=$(CDPATH= cd -P "$(dirname "$base_dir")" && pwd)
case "$archive" in
  "$base_dir/data"|"$base_dir/data/"*|"$base_dir/uploads"|"$base_dir/uploads/"*)
    fail "the restore archive must be stored outside destination data/ and uploads/"
    ;;
esac

if [ "$confirm_stopped" -ne 1 ]; then
  command -v docker >/dev/null 2>&1 ||
    fail "Docker is unavailable; stop the application and pass --confirm-stopped"
  running=$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null) ||
    fail "cannot verify container '$container'; pass its name or use --confirm-stopped after stopping the application"
  [ "$running" != "true" ] ||
    fail "container '$container' is running; stop it before restoring SQLite and uploads"
fi

member_list=$(mktemp "${TMPDIR:-/tmp}/manjyun-restore-list.XXXXXX")
type_list=$(mktemp "${TMPDIR:-/tmp}/manjyun-restore-types.XXXXXX")
cleanup_lists() {
  rm -f "$member_list" "$type_list"
}
trap cleanup_lists EXIT
trap 'exit 130' HUP INT TERM
tar -tzf "$archive" >"$member_list" || fail "archive is unreadable or corrupt"
tar -tvzf "$archive" >"$type_list" || fail "archive metadata is unreadable"

awk '
  BEGIN { data = 0; uploads = 0; bad = 0 }
  {
    name = $0
    sub(/^\.\//, "", name)
    if (name ~ /^\// || name ~ /(^|\/)\.\.(\/|$)/) bad = 1
    if (name == "data" || name ~ /^data\//) data = 1
    else if (name == "uploads" || name ~ /^uploads\//) uploads = 1
    else if (name != "manjyun-backup-manifest.txt") bad = 1
  }
  END { exit (bad || !data || !uploads) ? 1 : 0 }
' "$member_list" ||
  fail "archive must contain only data/, uploads/, and the backup manifest"

awk '
  {
    type = substr($0, 1, 1)
    if (type != "d" && type != "-") exit 1
  }
' "$type_list" || fail "archive contains links or unsupported special files"

printf '%s\n' "Restore archive : $archive"
printf '%s\n' "Destination     : $base_dir/{data,uploads}"
printf '%s\n' "Stopped state   : confirmed"
if [ "$dry_run" -eq 1 ]; then
  printf '%s\n' "Dry run complete; archive and path checks passed, no files were written."
  exit 0
fi
[ "$approved" -eq 1 ] ||
  fail "refusing to replace current data without --yes (run --dry-run first)"

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
if [ -z "$rollback_dir" ]; then
  rollback_dir=$base_parent/$(basename "$base_dir")-restore-backups
fi
case "$rollback_dir" in
  /*) ;;
  *) rollback_dir=$PWD/$rollback_dir ;;
esac
mkdir -p "$rollback_dir"
rollback_dir=$(CDPATH= cd -P "$rollback_dir" && pwd)
case "$rollback_dir" in
  "$base_dir/data"|"$base_dir/data/"*|"$base_dir/uploads"|"$base_dir/uploads/"*)
    fail "rollback archives must be stored outside data/ and uploads/"
    ;;
esac

umask 077
staging=$(mktemp -d "$base_parent/.manjyun-restore-stage.XXXXXX")
old_tree=$(mktemp -d "$base_parent/.manjyun-restore-old.XXXXXX")
swap_started=0
swap_complete=0
old_data=0
old_uploads=0
new_data=0
new_uploads=0
rollback_temporary=

rollback_swap() {
  status=$?
  if [ "$swap_started" -eq 1 ] && [ "$swap_complete" -ne 1 ]; then
    [ "$new_data" -ne 1 ] || rm -rf "$base_dir/data"
    [ "$new_uploads" -ne 1 ] || rm -rf "$base_dir/uploads"
    [ "$old_data" -ne 1 ] || mv "$old_tree/data" "$base_dir/data"
    [ "$old_uploads" -ne 1 ] || mv "$old_tree/uploads" "$base_dir/uploads"
  fi
  rm -rf "$staging" "$old_tree"
  rm -f "$member_list" "$type_list"
  [ -z "$rollback_temporary" ] || rm -f "$rollback_temporary"
  exit "$status"
}
trap rollback_swap EXIT
trap 'exit 130' HUP INT TERM

tar -xzf "$archive" -C "$staging"
[ -d "$staging/data" ] && [ ! -L "$staging/data" ] ||
  fail "staged archive has no real data/ directory"
[ -d "$staging/uploads" ] && [ ! -L "$staging/uploads" ] ||
  fail "staged archive has no real uploads/ directory"

current_entries=
if [ -e "$base_dir/data" ]; then
  [ -d "$base_dir/data" ] && [ ! -L "$base_dir/data" ] ||
    fail "current data path is not a real directory"
  current_entries="$current_entries data"
fi
if [ -e "$base_dir/uploads" ]; then
  [ -d "$base_dir/uploads" ] && [ ! -L "$base_dir/uploads" ] ||
    fail "current uploads path is not a real directory"
  current_entries="$current_entries uploads"
fi
if [ -n "$current_entries" ] &&
  { [ ! -d "$base_dir/data" ] || [ ! -d "$base_dir/uploads" ]; }; then
  fail "destination is partially initialized; both data/ and uploads/ are required for an automatic rollback backup"
fi
if [ -n "$current_entries" ] &&
  find "$base_dir/data" "$base_dir/uploads" \
    ! -type d ! -type f -print 2>/dev/null | grep -q .; then
  fail "current data/ and uploads/ contain links or special files; refusing to create an incomplete rollback backup"
fi

rollback_archive=
if [ -n "$current_entries" ]; then
  rollback_archive=$rollback_dir/manjyun-blog-pre-restore-$timestamp-$$.tar.gz
  [ ! -e "$rollback_archive" ] ||
    fail "refusing to overwrite rollback archive: $rollback_archive"
  rollback_temporary=$rollback_dir/.manjyun-pre-restore-$timestamp-$$.tmp
  # The entry names are fixed literals assembled above, not user input.
  # shellcheck disable=SC2086
  tar -czf "$rollback_temporary" -C "$base_dir" $current_entries
  tar -tzf "$rollback_temporary" >/dev/null
  if ! ln "$rollback_temporary" "$rollback_archive" 2>/dev/null; then
    (set -C; cat "$rollback_temporary" >"$rollback_archive") 2>/dev/null ||
      fail "could not publish the pre-restore backup safely"
  fi
  tar -tzf "$rollback_archive" >/dev/null ||
    fail "published pre-restore backup did not pass its final integrity check"
  rm -f "$rollback_temporary"
  chmod 600 "$rollback_archive" 2>/dev/null || true
fi

swap_started=1
if [ -e "$base_dir/data" ]; then
  mv "$base_dir/data" "$old_tree/data"
  old_data=1
fi
if [ -e "$base_dir/uploads" ]; then
  mv "$base_dir/uploads" "$old_tree/uploads"
  old_uploads=1
fi
mv "$staging/data" "$base_dir/data"
new_data=1
mv "$staging/uploads" "$base_dir/uploads"
new_uploads=1
swap_complete=1

rm -rf "$old_tree" "$staging"
rm -f "$member_list" "$type_list"
trap - EXIT HUP INT TERM

printf '%s\n' "Restore completed: $base_dir"
if [ -n "$rollback_archive" ]; then
  printf '%s\n' "Pre-restore backup: $rollback_archive"
else
  printf '%s\n' "Pre-restore backup: not needed (destination was empty)"
fi
printf '%s\n' "Start the application and verify login, recent content, and uploaded files."
