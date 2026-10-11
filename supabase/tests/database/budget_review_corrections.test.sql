begin;
select plan(4);

select ok(
  has_function_privilege('authenticated', 'public.budget_get_review_queue_v1(text,integer)'::regprocedure, 'execute'),
  'member can read the enriched review queue'
);
select ok(
  not has_function_privilege('authenticated', 'finance.budget_get_review_queue_v1_stage5(text,integer)'::regprocedure, 'execute'),
  'member cannot call the private review queue body'
);
select ok(
  not has_function_privilege('authenticated', 'finance.budget_get_fund_v1_stage5(uuid,date,date,text,integer)'::regprocedure, 'execute'),
  'member cannot call the private fund body'
);
select ok(
  not has_function_privilege('anon', 'public.budget_publish_with_movement_v1(uuid,jsonb)'::regprocedure, 'execute'),
  'anon cannot publish and move together'
);

select * from finish();
rollback;
