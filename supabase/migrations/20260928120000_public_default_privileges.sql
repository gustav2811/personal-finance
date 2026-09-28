-- Future public objects are opt-in. Existing grants are unchanged.
-- Email authorization stays until every household_members row has auth_user_id.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

do $admin$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role';
exception
  when insufficient_privilege then
    raise notice 'supabase_admin default privileges unchanged: %', sqlerrm;
end
$admin$;
