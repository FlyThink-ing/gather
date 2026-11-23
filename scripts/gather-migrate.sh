#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
shopt -s nullglob

mode=${1:-}
directory=${2:-}
if [[ $# -ne 2 || ( $mode != plan && $mode != apply ) || ! -d $directory ]]; then
  printf 'Usage: bash %s {plan|apply} MIGRATIONS_DIRECTORY\n' "$0" >&2
  exit 2
fi

db_container=${DB_CONTAINER:-supabase-db}
db_args=(-X -U "${DB_USER:-supabase_admin}" -d "${DB_NAME:-postgres}" -v ON_ERROR_STOP=1 -P pager=off)
history=$(docker exec "$db_container" psql "${db_args[@]}" -Atc \
  'select version from supabase_migrations.schema_migrations order by version collate "C";')
if [[ -z $history ]]; then
  printf 'Migration history is empty. Verify and register the existing database baseline first.\n' >&2
  exit 1
fi
mapfile -t applied <<< "$history"

cd -- "$directory"
migration_files=(*.sql)
if [[ -z ${migration_files[0]:-} ]]; then
  printf 'No SQL migration files in %s.\n' "$directory" >&2
  exit 1
fi
sorted_files=$(printf '%s\n' "${migration_files[@]}" | sort -t _ -k1,1)
mapfile -t migration_files <<< "$sorted_files"

pending_files=()
previous_version=
applied_index=0

for file in "${migration_files[@]}"; do
  if [[ ! -f $file || ! -r $file || ! -s $file || ! $file =~ ^([0-9]+)_([A-Za-z0-9_-]+)\.sql$ ]]; then
    printf 'Invalid migration file: %s\n' "$file" >&2
    exit 1
  fi
  version=${BASH_REMATCH[1]}
  if [[ $previous_version == "$version" ]]; then
    printf 'Duplicate migration version in release: %s\n' "$version" >&2
    exit 1
  fi
  previous_version=$version

  if (( applied_index < ${#applied[@]} )); then
    if [[ $version != "${applied[applied_index]}" ]]; then
      printf 'Migration history differs from release: database has %s where release has %s.\n' \
        "${applied[applied_index]}" "$version" >&2
      exit 1
    fi
    applied_index=$((applied_index + 1))
  else
    pending_files+=("$file")
  fi
done

if (( applied_index < ${#applied[@]} )); then
  printf 'Release is missing applied migration %s. Use a release with the complete migration set.\n' \
    "${applied[applied_index]}" >&2
  exit 1
fi

printf 'Latest recorded version: %s\n' "${applied[applied_index - 1]}"
if [[ -z ${pending_files[0]:-} ]]; then
  printf 'No pending migrations.\n'
  exit 0
fi
printf 'Pending migrations:\n'
for file in "${pending_files[@]}"; do
  printf '  %s\n' "$file"
done
if [[ $mode == plan ]]; then
  exit 0
fi

for file in "${pending_files[@]}"; do
  stem=${file%.sql}
  version=${stem%%_*}
  name=${stem#*_}
  docker exec -i "$db_container" psql "${db_args[@]}" -1 \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');" \
    -f - < "$file"
  printf 'Committed %s\n' "$file"
done
