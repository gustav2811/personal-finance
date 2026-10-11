begin;
select plan(8);

select ok(
  has_function_privilege('authenticated', 'public.budget_list_members_v1()'::regprocedure, 'execute'),
  'member can list household members'
);
select ok(
  not has_function_privilege('anon', 'public.budget_list_members_v1()'::regprocedure, 'execute'),
  'anon cannot list household members'
);
select ok(
  not has_function_privilege('service_role', 'public.budget_get_cutover_v1()'::regprocedure, 'execute'),
  'service role cannot read cutover'
);
select ok(
  not has_function_privilege('anon', 'public.budget_get_cutover_v1()'::regprocedure, 'execute'),
  'anon cannot read cutover'
);
select ok(
  not has_function_privilege('service_role', 'public.budget_list_members_v1()'::regprocedure, 'execute'),
  'service role cannot list household members'
);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f501');
insert into finance.household_members(id, household_id, email, auth_user_id, role) values
  ('00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f501', 'gustav@test.invalid', '00000000-0000-4000-8000-00000000f503', 'member'),
  ('00000000-0000-4000-8000-00000000f504', '00000000-0000-4000-8000-00000000f501', 'cara@test.invalid', '00000000-0000-4000-8000-00000000f505', 'member');
insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f506');
insert into finance.household_members(id, household_id, email, auth_user_id, role) values
  ('00000000-0000-4000-8000-00000000f507', '00000000-0000-4000-8000-00000000f506', 'other@test.invalid', '00000000-0000-4000-8000-00000000f508', 'member');
insert into public.accounts(account_id, source_account_id, name, household_id, source_system, currency_code) values
  ('00000000-0000-4000-8000-00000000f509', 'workspace-source', 'Access', '00000000-0000-4000-8000-00000000f501', 'test', 'ZAR');
insert into finance.categories(id, household_id, name, slug) values
  ('00000000-0000-4000-8000-00000000f50a', '00000000-0000-4000-8000-00000000f501', 'Groceries', 'groceries-workspace');

create temp table budget_workspace_result (
  listed jsonb,
  cutover jsonb
);

do $member$
declare
  listed jsonb;
  cutover jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000f503', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f503', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  listed := public.budget_list_members_v1();
  cutover := public.budget_get_cutover_v1();
  execute 'reset role';
  insert into budget_workspace_result(listed, cutover) values (listed, cutover);
end
$member$;

select ok(
  (select count(*) from budget_workspace_result, lateral jsonb_array_elements(listed->'members')) = 2,
  'member read returns both household names'
);
select ok(
  (select listed->'members' from budget_workspace_result) @> '[{"email":"cara@test.invalid"}]'::jsonb
  and not ((select listed->'members' from budget_workspace_result) @> '[{"email":"other@test.invalid"}]'::jsonb),
  'member read does not cross households'
);
select ok(
  (select cutover->'accounts' from budget_workspace_result) @> '[{"name":"Access"}]'::jsonb
  and (select jsonb_array_length(cutover->'categories') from budget_workspace_result) = 1
  and (select cutover->'reconciliation' from budget_workspace_result) = 'null'::jsonb,
  'cutover read lists the account and does not invent a reconciliation'
);

select * from finish();
rollback;
