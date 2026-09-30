#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="public.ecr.aws/supabase/postgres@sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f"
container_name="investments-budget-db-${$}-${RANDOM}"
container_id=""

fail_remote_override() {
  printf '%s\n' "budget-db-tests refuses remote database overrides; unset DATABASE_URL, SUPABASE_DB_URL, PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD" >&2
  exit 2
}

for variable in DATABASE_URL SUPABASE_DB_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; do
  if [[ -n "${!variable:-}" ]]; then
    fail_remote_override
  fi
done

command -v docker >/dev/null 2>&1 || {
  printf '%s\n' "budget-db-tests requires Docker" >&2
  exit 2
}

migrations=()
while IFS= read -r migration; do
  migrations+=("$migration")
done < <(find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)
tests=()
while IFS= read -r test_file; do
  tests+=("$test_file")
done < <(find "$repo_root/supabase/tests/database" -maxdepth 1 -type f -name '*.test.sql' -print 2>/dev/null | sort)

if (( ${#tests[@]} == 0 )); then
  printf '%s\n' "budget-db-tests requires at least one supabase/tests/database/*.test.sql file" >&2
  exit 2
fi

cleanup() {
  status=$?
  if [[ -n "$container_id" ]]; then
    if (( status != 0 )); then
      docker logs --tail 80 "$container_id" >&2 2>/dev/null || true
    fi
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

container_id="$(docker run -d --rm --name "$container_name" \
  --network none \
  -e POSTGRES_USER=supabase_admin \
  -e POSTGRES_PASSWORD="budget-db-tests-${$}-${RANDOM}" \
  -e POSTGRES_DB=postgres \
  "$image")"

for attempt in {1..120}; do
  if docker logs "$container_id" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' \
    && docker exec "$container_id" pg_isready -h 127.0.0.1 -U supabase_admin -d postgres >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 120 )); then
    printf '%s\n' "PostgreSQL final init did not become ready" >&2
    exit 1
  fi
  sleep 1
done

psql() {
  docker exec -i -e PGOPTIONS='-c search_path=public,extensions' "$container_id" \
    psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

psql < "$repo_root/supabase/tests/bootstrap/legacy_public.sql"

for migration in "${migrations[@]}"; do
  printf 'Applying %s\n' "${migration#"$repo_root/"}"
  psql < "$migration"
done

psql <<'SQL'
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
SQL

for test_file in "${tests[@]}"; do
  printf 'Testing %s\n' "${test_file#"$repo_root/"}"
  test_output="$(mktemp -t budget-db-test.XXXXXX)"
  if ! psql < "$test_file" > "$test_output"; then
    cat "$test_output"
    rm -f "$test_output"
    exit 1
  fi
  cat "$test_output"
  if grep -Eq '^(not ok|Bail out!)|# Looks like you failed' "$test_output"; then
    rm -f "$test_output"
    printf '%s\n' "pgTAP assertions failed" >&2
    exit 1
  fi
  rm -f "$test_output"
done
