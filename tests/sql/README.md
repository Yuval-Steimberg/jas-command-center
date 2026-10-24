# SQL tests for 0005 (volunteers)

Run against a throwaway Postgres 16 with 0001, 0003 and 0005 applied. They are
not in CI: they need a real server, and the point is real concurrency.

```sh
# a local server (any port; the scripts use /tmp/claude-0/pg:5544, edit P= to change)
initdb -D /tmp/pgdata && pg_ctl -D /tmp/pgdata -o "-k /tmp/claude-0/pg -p 5544" start
createdb -h /tmp/claude-0/pg -p 5544 -U postgres t
# 0001 references Supabase's auth.users: stub it
psql -h /tmp/claude-0/pg -p 5544 -U postgres -d t -c "create schema auth; create table auth.users (id uuid primary key, email text);"
for f in 0001_init 0003_crm_inventory 0005_volunteers; do psql -h /tmp/claude-0/pg -p 5544 -U postgres -d t -f supabase/migrations/$f.sql; done

psql -h /tmp/claude-0/pg -p 5544 -U postgres -d t -f tests/sql/volunteers.sql   # rules, one session
sh tests/sql/volunteers-concurrency.sh                                             # races
```

`volunteers.sql` stops at the first error (`ON_ERROR_STOP`) and prints NOTICEs
for each refusal it expects. `volunteers-concurrency.sh` prints counts that must
match the expectation written next to each.

## The store against a real PostgREST

`tests/integration/volunteers-postgrest.test.ts` runs the Supabase store (column
mapping, RPC argument names, error mapping, paging past `max_rows`) against
PostgREST 12 on the same database:

```sh
# postgrest.conf: db-uri = "postgres://postgres@/t?host=/tmp/claude-0/pg&port=5544"
#                 db-schemas = "public", db-anon-role = "anon", db-max-rows = 1000
#                 jwt-secret = "<32+ chars>", server-port = 3399
psql … -c "create role anon nologin; create role service_role nologin bypassrls; grant anon, service_role to postgres;
           grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;"
postgrest postgrest.conf &
VOL_PGRST_URL=http://127.0.0.1:3399 VOL_PGRST_JWT_SECRET=<same secret> npx vitest run tests/integration/volunteers-postgrest.test.ts
```

Without the two variables the suite is skipped.
