-- Plan commands are deliberately separate from the ingest and reconciliation workers.
create or replace function finance.budget_plan_payload(
  p_payload jsonb,
  p_publish boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v jsonb := '{}'::jsonb;
  x jsonb;
  a jsonb := '[]'::jsonb;
begin
  if p_publish then
    perform finance.budget_validate_object(p_payload,
      array['draft_id','expected_draft_revision','expected_latest_version_number','reason'],
      array['expected_parent_version_id']);
    return jsonb_build_object('draft_id',finance.budget_uuid(p_payload,'draft_id'),
      'expected_draft_revision',finance.budget_integer(p_payload,'expected_draft_revision',1,9007199254740991),
      'expected_parent_version_id',finance.budget_uuid(p_payload,'expected_parent_version_id',true),
      'expected_latest_version_number',finance.budget_integer(p_payload,'expected_latest_version_number',0,9007199254740991),
      'reason',finance.budget_text(p_payload,'reason'));
  end if;
  perform finance.budget_validate_object(p_payload,
    array['starts_on_cycle','reason','income_assumptions','source_references','lines'],
    array['draft_id','expected_draft_revision','parent_version_id']);
  if jsonb_typeof(p_payload->'income_assumptions') is distinct from 'array'
     or jsonb_typeof(p_payload->'source_references') is distinct from 'array'
     or jsonb_typeof(p_payload->'lines') is distinct from 'array' then
    perform finance.budget_fail('budget_invalid', 'plan arrays required');
  end if;
  for x in select value from jsonb_array_elements(p_payload->'income_assumptions') loop
    perform finance.budget_validate_object(
      x, array['member_id','expected_net_cents','expected_on','provenance'], array[]::text[]
    );
    if finance.budget_cents(x, 'expected_net_cents') < 0 then
      perform finance.budget_fail('budget_invalid', 'income forecast must be nonnegative');
    end if;
    a := a || jsonb_build_array(jsonb_build_object(
      'member_id', finance.budget_uuid(x, 'member_id'),
      'expected_net_cents', finance.budget_cents(x, 'expected_net_cents')::text,
      'expected_on', finance.budget_date(x, 'expected_on'),
      'provenance', finance.budget_text(x, 'provenance')
    ));
  end loop;
  v := jsonb_build_object(
    'draft_id', finance.budget_uuid(p_payload, 'draft_id', true),
    'expected_draft_revision', finance.budget_integer(p_payload, 'expected_draft_revision', 1, 9007199254740991, true),
    'parent_version_id', finance.budget_uuid(p_payload, 'parent_version_id', true),
    'starts_on_cycle', finance.budget_date(p_payload, 'starts_on_cycle'),
    'reason', finance.budget_text(p_payload, 'reason'),
    'income_assumptions', a
  );
  a := '[]'::jsonb;
  for x in select value from jsonb_array_elements(p_payload->'source_references') loop
    perform finance.budget_validate_object(x, array['source','reference'], array[]::text[]);
    a := a || jsonb_build_array(jsonb_build_object(
      'source', finance.budget_text(x, 'source'),
      'reference', finance.budget_text(x, 'reference')
    ));
  end loop;
  v := v || jsonb_build_object('source_references', a);
  a := '[]'::jsonb;
  for x in select value from jsonb_array_elements(p_payload->'lines') loop
    perform finance.budget_validate_object(
      x,
      array[
        'stable_line_id','fund_id','name','beneficiary_scope','kind',
        'contribution_cents','funding_behaviour','recurrence','rollover_policy'
      ],
      array[
        'category_id','category_name_snapshot','group_name_snapshot',
        'beneficiary_member_id','planned_payer_member_id','target_cents','due_on',
        'expected_payment_on','expected_payment_account_id','match_category_id'
      ]
    );
    if finance.budget_text(x, 'beneficiary_scope') not in ('shared','member')
       or finance.budget_text(x, 'kind') not in ('consumption','contribution','debt_commitment')
       or finance.budget_text(x, 'funding_behaviour') not in (
         'cycle_allowance','accumulating','target_by_date','reserve_target'
       )
       or finance.budget_text(x, 'recurrence') not in ('cycle','annual','once')
       or finance.budget_text(x, 'rollover_policy') not in ('carry','release_explicit') then
      perform finance.budget_fail('budget_invalid', 'invalid line enum');
    end if;
    if (finance.budget_text(x,'beneficiary_scope')='member') is distinct from (finance.budget_uuid(x,'beneficiary_member_id',true) is not null) then perform finance.budget_fail('budget_invalid','line beneficiary scope'); end if;
    if finance.budget_cents(x,'contribution_cents') < 0 or finance.budget_cents(x,'target_cents',true) < 0 then perform finance.budget_fail('budget_invalid','line cents must be nonnegative'); end if;
    if finance.budget_text(x,'funding_behaviour')='target_by_date' and (finance.budget_cents(x,'target_cents',true) is null or finance.budget_date(x,'due_on',true) is null) then perform finance.budget_fail('budget_invalid','target by date requires target and due date'); end if;
    if finance.budget_text(x,'funding_behaviour')='reserve_target' and finance.budget_cents(x,'target_cents',true) is null then perform finance.budget_fail('budget_invalid','reserve target requires target'); end if;
    a := a || jsonb_build_array(jsonb_build_object(
      'stable_line_id', finance.budget_uuid(x, 'stable_line_id'),
      'fund_id', finance.budget_uuid(x, 'fund_id'),
      'name', finance.budget_text(x, 'name'),
      'category_id', finance.budget_uuid(x, 'category_id', true),
      'category_name_snapshot', finance.budget_text(x, 'category_name_snapshot', true),
      'group_name_snapshot', finance.budget_text(x, 'group_name_snapshot', true),
      'beneficiary_scope', finance.budget_text(x, 'beneficiary_scope'),
      'beneficiary_member_id', finance.budget_uuid(x, 'beneficiary_member_id', true),
      'planned_payer_member_id', finance.budget_uuid(x, 'planned_payer_member_id', true),
      'kind', finance.budget_text(x, 'kind'),
      'contribution_cents', finance.budget_cents(x, 'contribution_cents')::text,
      'funding_behaviour', finance.budget_text(x, 'funding_behaviour'),
      'target_cents', finance.budget_cents(x, 'target_cents', true)::text,
      'due_on', finance.budget_date(x, 'due_on', true),
      'recurrence', finance.budget_text(x, 'recurrence'),
      'rollover_policy', finance.budget_text(x, 'rollover_policy'),
      'expected_payment_on', finance.budget_date(x, 'expected_payment_on', true),
      'expected_payment_account_id', finance.budget_uuid(x, 'expected_payment_account_id', true),
      'match_category_id', finance.budget_uuid(x, 'match_category_id', true)
    ));
  end loop;
  return v || jsonb_build_object('lines',a);
end $$;

create or replace function public.budget_save_draft_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_temp set timezone = 'UTC' as $$
declare
  p jsonb;
  replay jsonb;
  h uuid;
  actor uuid;
  d finance.budget_versions%rowtype;
  line jsonb;
  result jsonb;
  old_ids jsonb;
begin
  p := finance.budget_plan_payload(p_payload); replay := finance.budget_begin_command(p_command_id,'budget_save_draft_v1',p); if replay is not null then return replay; end if;
  h := finance.resolve_caller_household(); actor := finance.budget_actor_member(h);
  if extract(day from (p->>'starts_on_cycle')::date) <> 23 then perform finance.budget_fail('budget_invalid','starts_on_cycle must be cycle start'); end if;
  if exists(select 1 from jsonb_array_elements(p->'income_assumptions') x join lateral (select (x->>'member_id')::uuid id) q on true where not exists(select 1 from finance.household_members m where m.household_id=h and m.id=q.id)) then perform finance.budget_fail('budget_forbidden','income member'); end if;
  if exists(select 1 from jsonb_array_elements(p->'lines') x where not exists(select 1 from finance.funds f where f.household_id=h and f.id=(x->>'fund_id')::uuid and f.status='active') or ((x->>'category_id') is not null and not exists(select 1 from finance.categories c where c.household_id=h and c.id=(x->>'category_id')::uuid)) or ((x->>'match_category_id') is not null and not exists(select 1 from finance.categories c where c.household_id=h and c.id=(x->>'match_category_id')::uuid)) or ((x->>'expected_payment_account_id') is not null and not exists(select 1 from public.accounts q where q.household_id=h and q.account_id=(x->>'expected_payment_account_id')::uuid)) or ((x->>'beneficiary_member_id') is not null and not exists(select 1 from finance.household_members m where m.household_id=h and m.id=(x->>'beneficiary_member_id')::uuid)) or ((x->>'planned_payer_member_id') is not null and not exists(select 1 from finance.household_members m where m.household_id=h and m.id=(x->>'planned_payer_member_id')::uuid))) then perform finance.budget_fail('budget_forbidden','line reference'); end if;
  if p->>'draft_id' is null then
    if p->>'expected_draft_revision' is not null then perform finance.budget_fail('budget_invalid','new draft has no expected revision'); end if;
    if p->>'parent_version_id' is not null and not exists(select 1 from finance.budget_versions q where q.household_id=h and q.id=(p->>'parent_version_id')::uuid and q.state='published') then perform finance.budget_fail('budget_forbidden','parent version'); end if;
    insert into finance.budget_versions(household_id,parent_version_id,starts_on_cycle,actor_id,reason,income_assumptions,source_references) values(h,(p->>'parent_version_id')::uuid,(p->>'starts_on_cycle')::date,actor,p->>'reason',p->'income_assumptions',p->'source_references') returning * into d;
  else
    select * into d from finance.budget_versions where household_id=h and id=(p->>'draft_id')::uuid for update;
    if not found then perform finance.budget_fail('budget_not_found','draft'); end if;
    if d.state <> 'draft' then perform finance.budget_fail('budget_stale','draft published'); end if;
    if p->>'expected_draft_revision' is null then perform finance.budget_fail('budget_invalid','missing expected_draft_revision'); end if;
    if d.draft_revision <> (p->>'expected_draft_revision')::bigint then perform finance.budget_fail('budget_stale','draft revision'); end if;
    if d.draft_revision >= 9007199254740991 then perform finance.budget_fail('budget_invalid','draft revision out of range'); end if;
    if p->>'parent_version_id' is not null and not exists(select 1 from finance.budget_versions q where q.household_id=h and q.id=(p->>'parent_version_id')::uuid and q.state='published') then perform finance.budget_fail('budget_forbidden','parent version'); end if;
    update finance.budget_versions set parent_version_id=(p->>'parent_version_id')::uuid,starts_on_cycle=(p->>'starts_on_cycle')::date,reason=p->>'reason',income_assumptions=p->'income_assumptions',source_references=p->'source_references',draft_revision=d.draft_revision+1 where id=d.id returning * into d;
  end if;
  select coalesce(jsonb_object_agg(stable_line_id::text,id::text),'{}'::jsonb) into old_ids from finance.budget_lines where version_id=d.id;
  delete from finance.budget_lines where version_id=d.id;
  for line in select value from jsonb_array_elements(p->'lines') loop
    insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,category_id,category_name_snapshot,group_name_snapshot,beneficiary_scope,beneficiary_member_id,planned_payer_member_id,kind,contribution_cents,funding_behaviour,target_cents,due_on,recurrence,rollover_policy,expected_payment_on,expected_payment_account_id,match_category_id)
    values(coalesce((old_ids->>(line->>'stable_line_id'))::uuid,gen_random_uuid()),h,d.id,(line->>'stable_line_id')::uuid,(line->>'fund_id')::uuid,line->>'name',(line->>'category_id')::uuid,line->>'category_name_snapshot',line->>'group_name_snapshot',line->>'beneficiary_scope',(line->>'beneficiary_member_id')::uuid,(line->>'planned_payer_member_id')::uuid,line->>'kind',(line->>'contribution_cents')::bigint,line->>'funding_behaviour',(line->>'target_cents')::bigint,(line->>'due_on')::date,line->>'recurrence',line->>'rollover_policy',(line->>'expected_payment_on')::date,(line->>'expected_payment_account_id')::uuid,(line->>'match_category_id')::uuid);
  end loop;
  set constraints all immediate;
  result:=jsonb_build_object('version_id',d.id,'draft_revision',d.draft_revision);
  return finance.budget_finish_command(p_command_id,'budget_save_draft_v1',p,result);
end $$;

create or replace function public.budget_publish_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_temp set timezone = 'UTC' as $$
declare
  p jsonb;
  replay jsonb;
  h uuid;
  actor uuid;
  d finance.budget_versions%rowtype;
  latest_number bigint;
  nextn bigint;
  warnings jsonb;
begin
 p:=finance.budget_plan_payload(p_payload,true); replay:=finance.budget_begin_command(p_command_id,'budget_publish_v1',p); if replay is not null then return replay; end if; h:=finance.resolve_caller_household(); actor:=finance.budget_actor_member(h); perform 1 from finance.households where id=h for update;
 select * into d from finance.budget_versions where household_id=h and id=(p->>'draft_id')::uuid for update; if not found then perform finance.budget_fail('budget_not_found','draft'); end if;
 if d.state<>'draft' or d.draft_revision<>(p->>'expected_draft_revision')::bigint or d.parent_version_id is distinct from (p->>'expected_parent_version_id')::uuid then perform finance.budget_fail('budget_stale','draft'); end if;
 select coalesce(max(version_number),0) into latest_number from finance.budget_versions where household_id=h and state='published';
 if latest_number<>(p->>'expected_latest_version_number')::bigint then perform finance.budget_fail('budget_stale','latest version'); end if;
 if latest_number >= 9007199254740991 then perform finance.budget_fail('budget_invalid','version number out of range'); end if;
 nextn := latest_number + 1;
 update finance.budget_versions set state='published',version_number=nextn,published_at=now(),reason=p->>'reason',actor_id=actor where id=d.id;
 select coalesce(jsonb_agg(jsonb_build_object('code','future_plan_divergence','version_id',id) order by starts_on_cycle,version_number),'[]'::jsonb) into warnings from finance.budget_versions where household_id=h and state='published' and id<>d.id and starts_on_cycle>(select starts_on_cycle from finance.budget_versions where id=d.id);
 set constraints all immediate;
 return finance.budget_finish_command(p_command_id,'budget_publish_v1',p,jsonb_build_object('version_id',d.id,'version_number',nextn,'warnings',warnings));
end $$;

revoke all on function finance.budget_plan_payload(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.budget_save_draft_v1(uuid,jsonb) from public,anon,service_role;
revoke all on function public.budget_publish_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.budget_save_draft_v1(uuid,jsonb), public.budget_publish_v1(uuid,jsonb) to authenticated;
