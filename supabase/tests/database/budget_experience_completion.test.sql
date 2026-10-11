begin;
select plan(4);

select ok(
  has_function_privilege('authenticated', 'public.budget_get_source_review_v1(text,uuid)'::regprocedure, 'execute'),
  'member can read a saved review'
);
select ok(
  not has_function_privilege('anon', 'public.budget_publish_with_movement_v1(uuid,jsonb)'::regprocedure, 'execute'),
  'anon cannot publish and move together'
);
select ok(
  not has_function_privilege('service_role', 'public.budget_list_devices_v1()'::regprocedure, 'execute'),
  'service role cannot list wallet devices'
);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f601');
insert into finance.household_members(id, household_id, email, auth_user_id, role) values
  ('00000000-0000-4000-8000-00000000f602', '00000000-0000-4000-8000-00000000f601', 'review@test.invalid', '00000000-0000-4000-8000-00000000f603', 'member');

create temp table budget_review_result (payload jsonb);

do $member$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000f603', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f603', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result := public.budget_get_source_review_v1('missing-source', null);
  execute 'reset role';
  insert into budget_review_result(payload) values (result);
end
$member$;

select ok(
  (select payload->>'found' from budget_review_result) = 'false',
  'a missing source is not invented as a review decision'
);

select * from finish();
rollback;
