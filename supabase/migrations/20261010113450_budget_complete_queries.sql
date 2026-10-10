-- Stage 5: member query surface.  This layer is deliberately read-only: all
-- calculations use the append-only records and the existing calculation core.

create or replace function finance.budget_cursor_encode(p_value jsonb)
returns text language sql immutable set search_path=pg_temp set timezone='UTC' as $$
  select translate(rtrim(replace(encode(convert_to(p_value::text,'utf8'),'base64'),chr(10),''),'='),'+/','-_')
$$;

create or replace function finance.budget_cursor_decode(p_cursor text)
returns jsonb language plpgsql immutable set search_path=pg_temp set timezone='UTC' as $$
declare v text; n integer;
begin
  if p_cursor is null or p_cursor = '' or p_cursor !~ '^[A-Za-z0-9_-]+$' then
    perform finance.budget_fail('budget_invalid','invalid cursor');
  end if;
  n := length(p_cursor) % 4;
  if n = 1 then perform finance.budget_fail('budget_invalid','invalid cursor'); end if;
  v := translate(p_cursor,'-_','+/') || repeat('=',case when n=0 then 0 else 4-n end);
  begin return convert_from(decode(v,'base64'),'utf8')::jsonb;
  exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end;
end $$;

create or replace function finance.budget_json_cents(p_value numeric)
returns text language sql immutable set search_path=pg_temp set timezone='UTC' as $$
  select finance.budget_checked_bigint(p_value)::text
$$;

create or replace function finance.budget_cursor_validate(p_cursor text,p_kind text,p_household uuid,p_keys text[])
returns jsonb language plpgsql immutable set search_path=pg_temp set timezone='UTC' as $$
declare c jsonb; k text;
begin
  c:=finance.budget_cursor_decode(p_cursor);
  if jsonb_typeof(c)<>'object' or c->>'kind' is distinct from p_kind or c->>'v' is distinct from '1' or c->>'household_id' is distinct from p_household::text then perform finance.budget_fail('budget_invalid','invalid cursor'); end if;
  foreach k in array p_keys loop if not (c ? k) then perform finance.budget_fail('budget_invalid','invalid cursor'); end if; end loop;
  for k in select jsonb_object_keys(c) loop if not (k = any(p_keys) or k in ('v','kind','household_id')) then perform finance.budget_fail('budget_invalid','invalid cursor'); end if; end loop;
  return c;
exception when others then perform finance.budget_fail('budget_invalid','invalid cursor');
end $$;

-- Complete immutable version header and line snapshot.
create or replace function public.budget_list_versions_v1(p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; c jsonb; rows jsonb:='[]'; r record; next_cursor text; last_created timestamptz; last_id uuid; n integer:=0;
begin
  h:=finance.budget_reader_household();
  if p_limit is null or p_limit not between 1 and 200 then perform finance.budget_fail('budget_invalid','invalid limit'); end if;
  if p_cursor is not null then
    begin c:=finance.budget_cursor_validate(p_cursor,'versions',h,array['created_at','id']); last_created:=c->>'created_at'; last_id:=c->>'id';
      if last_created is null or last_id is null then perform finance.budget_fail('budget_invalid','invalid cursor'); end if;
    exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end;
  end if;
  for r in select v.* from finance.budget_versions v where v.household_id=h and v.state in ('draft','published')
    and (c is null or (v.created_at,v.id)<(last_created,last_id)) order by v.created_at desc,v.id desc limit p_limit+1 loop
    n:=n+1; if n>p_limit then next_cursor:=finance.budget_cursor_encode(jsonb_build_object('v',1,'kind','versions','household_id',h::text,'created_at',last_created,'id',last_id::text)); exit; end if;
    last_created:=r.created_at; last_id:=r.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('version_id',r.id::text,'state',r.state,'version_number',r.version_number,'parent_version_id',r.parent_version_id,'starts_on_cycle',r.starts_on_cycle,'draft_revision',r.draft_revision,'published_at',r.published_at,'created_at',r.created_at,'reason',r.reason,'calculation_version',r.calculation_version,'income_assumptions',r.income_assumptions,'source_references',r.source_references,'future_divergence',exists(select 1 from finance.budget_versions f where f.household_id=h and f.state='published' and f.starts_on_cycle>r.starts_on_cycle and f.id<>r.id)));
  end loop;
  return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',statement_timestamp(),'versions',rows,'next_cursor',next_cursor);
end $$;

create or replace function public.budget_get_version_v1(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; v finance.budget_versions%rowtype; lines jsonb;
begin
  h:=finance.budget_reader_household();
  select * into v from finance.budget_versions where household_id=h and id=p_version_id;
  if not found then perform finance.budget_fail('budget_not_found','version'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id::text,'stable_line_id',l.stable_line_id::text,'fund_id',l.fund_id::text,'name',l.name,'category_id',l.category_id,'category_name_snapshot',l.category_name_snapshot,'group_name_snapshot',l.group_name_snapshot,'beneficiary_scope',l.beneficiary_scope,'beneficiary_member_id',l.beneficiary_member_id,'planned_payer_member_id',l.planned_payer_member_id,'kind',l.kind,'contribution_cents',l.contribution_cents::text,'funding_behaviour',l.funding_behaviour,'target_cents',case when l.target_cents is null then null else l.target_cents::text end,'due_on',l.due_on,'recurrence',l.recurrence,'rollover_policy',l.rollover_policy,'expected_payment_on',l.expected_payment_on,'expected_payment_account_id',l.expected_payment_account_id,'match_category_id',l.match_category_id) order by l.id),'[]') into lines from finance.budget_lines l where l.household_id=h and l.version_id=v.id;
  return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',statement_timestamp(),'version',jsonb_build_object('id',v.id::text,'version_id',v.id::text,'state',v.state,'version_number',v.version_number,'parent_version_id',v.parent_version_id,'starts_on_cycle',v.starts_on_cycle,'draft_revision',v.draft_revision,'published_at',v.published_at,'created_at',v.created_at,'reason',v.reason,'calculation_version',v.calculation_version,'income_assumptions',v.income_assumptions,'source_references',v.source_references,'lines',lines));
end $$;

create or replace function public.budget_get_actuals_v1(p_filters jsonb,p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; f date; t date; scope text; bm uuid; pm uuid; c jsonb; rows jsonb:='[]'; r record; n int:=0; next_cursor text; last_date date; last_id uuid; filtered jsonb; household jsonb; benf jsonb; benh jsonb; payf jsonb; payh jsonb; availability_reasons jsonb:='[]'; availability_complete boolean:=true; resource_state jsonb;
begin
  h:=finance.budget_reader_household();
  if p_limit is null or p_limit not between 1 and 200 or jsonb_typeof(p_filters)<>'object' then perform finance.budget_fail('budget_invalid','invalid actuals filters'); end if;
  if exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('from','to','beneficiary_scope','beneficiary_member_id','paid_by_member_id')) or not (p_filters ? 'from') or not (p_filters ? 'to') then perform finance.budget_fail('budget_invalid','invalid actuals filters'); end if;
  begin f:=(p_filters->>'from')::date; t:=(p_filters->>'to')::date; scope:=p_filters->>'beneficiary_scope'; bm:=nullif(p_filters->>'beneficiary_member_id','')::uuid; pm:=nullif(p_filters->>'paid_by_member_id','')::uuid;
    if f is null or t is null or f>=t or scope is not null and scope not in ('shared','member') then perform finance.budget_fail('budget_invalid','invalid actuals filters'); end if;
    if (scope='shared' and bm is not null) or (scope='member' and bm is null) or (bm is not null and scope is distinct from 'member') then perform finance.budget_fail('budget_invalid','invalid beneficiary filter'); end if;
    if bm is not null and not exists(select 1 from finance.household_members where household_id=h and id=bm) then perform finance.budget_fail('budget_invalid','invalid beneficiary filter'); end if;
    if pm is not null and not exists(select 1 from finance.household_members where household_id=h and id=pm) then perform finance.budget_fail('budget_invalid','invalid payer filter'); end if;
  exception when others then perform finance.budget_fail('budget_invalid','invalid actuals filters'); end;
  resource_state:=finance.budget_resources(h,((t::timestamp at time zone 'Africa/Johannesburg')-interval '1 microsecond')); availability_reasons:=coalesce(resource_state->'reasons','[]'::jsonb); availability_complete:=coalesce((resource_state->>'complete')::boolean,false);
  if exists(select 1 from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status='needs_review' and (scope is null or a.beneficiary_scope=scope) and (bm is null or a.beneficiary_member_id=bm) and (pm is null or a.paid_by_member_id=pm)) then availability_complete:=false; availability_reasons:=availability_reasons||jsonb_build_array(jsonb_build_object('code','allocation_needs_review')); end if;
  if exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review') and s.transaction_id is not null and s.source_fingerprint is distinct from (finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint'))
     or exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review') and s.utility_entry_id is not null and s.source_fingerprint is distinct from (finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint')) then availability_complete:=false; availability_reasons:=availability_reasons||jsonb_build_array(jsonb_build_object('code','source_fingerprint_drift')); end if;
  if p_cursor is not null then begin c:=finance.budget_cursor_validate(p_cursor,'actuals',h,array['from','to','beneficiary_scope','beneficiary_member_id','paid_by_member_id','occurred_on','id']); if c->>'from'<>f::text or c->>'to'<>t::text or c->>'beneficiary_scope' is distinct from scope or c->>'beneficiary_member_id' is distinct from bm::text or c->>'paid_by_member_id' is distinct from pm::text then perform finance.budget_fail('budget_invalid','invalid cursor'); end if; last_date:=(c->>'occurred_on')::date; last_id:=(c->>'id')::uuid; exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end; end if;
  for r in select a.*,s.occurred_on,s.recorded_at,s.status,s.source_snapshot,s.source_fingerprint,s.transaction_id,s.utility_entry_id,s.supersedes_id,s.revision_number,s.classification_id,s.treatment_id,
      case when a.effect_kind='refund' and original.id is not null then original.beneficiary_scope else a.beneficiary_scope end attributed_beneficiary_scope,
      case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end attributed_beneficiary_member_id,
      case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end attributed_payer_member_id
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    left join finance.budget_allocations original on a.effect_kind='refund' and original.household_id=a.household_id and original.id=a.original_refund_allocation_id
    where a.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review')
      and (scope is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_scope else a.beneficiary_scope end)=scope)
      and (bm is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end)=bm)
      and (pm is null or (case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end)=pm)
      and (c is null or (s.occurred_on,a.id)<(last_date,last_id))
    order by s.occurred_on desc,a.id desc limit p_limit+1 loop
    n:=n+1; if n>p_limit then next_cursor:=finance.budget_cursor_encode(jsonb_build_object('v',1,'kind','actuals','household_id',h::text,'from',f,'to',t,'beneficiary_scope',scope,'beneficiary_member_id',bm,'paid_by_member_id',pm,'occurred_on',last_date,'id',last_id::text)); exit; end if; last_date:=r.occurred_on; last_id:=r.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('allocation_id',r.id::text,'ordinal',r.ordinal,'occurred_on',r.occurred_on,'amount_cents',r.amount_cents::text,'signed_amount_cents',r.amount_cents::text,'effect_kind',r.effect_kind,'actual_group',case when r.effect_kind in ('consumption','contribution','refund','income','financing','movement','unresolved') then r.effect_kind when r.effect_kind in ('required_debt_payment','extra_debt_payment') then 'debt_commitment' else 'other' end,'fund_id',r.fund_id,'category_id',r.category_id,'category_name_snapshot',r.category_name_snapshot,'beneficiary_scope',r.beneficiary_scope,'beneficiary_member_id',r.beneficiary_member_id,'paid_by_member_id',r.paid_by_member_id,'attributed_beneficiary_scope',r.attributed_beneficiary_scope,'attributed_beneficiary_member_id',r.attributed_beneficiary_member_id,'attributed_payer_member_id',r.attributed_payer_member_id,'payment_account_id',r.payment_account_id,'set_id',r.set_id,'revision_number',r.revision_number,'source_transaction_id',r.transaction_id,'utility_entry_id',r.utility_entry_id,'source_snapshot',r.source_snapshot,'source_fingerprint',r.source_fingerprint,'status',r.status,'provisional',r.status='needs_review','supersedes_id',r.supersedes_id,'classification_id',r.classification_id,'treatment_id',r.treatment_id,'financial_event_id',r.financial_event_id,'original_refund_allocation_id',r.original_refund_allocation_id,'opening_refund_reason',r.opening_refund_reason,'lineage',jsonb_build_object('source_transaction_id',r.transaction_id,'utility_entry_id',r.utility_entry_id,'supersedes_id',r.supersedes_id,'original_refund_allocation_id',r.original_refund_allocation_id,'financial_event_id',r.financial_event_id),'is_commitment',r.effect_kind in ('required_debt_payment','extra_debt_payment')));
  end loop;
  select coalesce(jsonb_object_agg(k,v),'{}') into filtered from (
    select case when a.effect_kind in ('required_debt_payment','extra_debt_payment') then 'debt_commitment' else a.effect_kind end k,
      finance.budget_json_cents(sum(a.amount_cents)) v
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    left join finance.budget_allocations original on a.effect_kind='refund' and original.household_id=a.household_id and original.id=a.original_refund_allocation_id
    where a.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review')
      and (scope is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_scope else a.beneficiary_scope end)=scope)
      and (bm is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end)=bm)
      and (pm is null or (case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end)=pm)
    group by 1) x;
  select coalesce(jsonb_object_agg(k,v),'{}') into household from (
    select case when a.effect_kind in ('required_debt_payment','extra_debt_payment') then 'debt_commitment' else a.effect_kind end k,
      finance.budget_json_cents(sum(a.amount_cents)) v
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    where a.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review') group by 1) x;
  with attributed as (
    select a.amount_cents,
      case when a.effect_kind in ('required_debt_payment','extra_debt_payment') then 'debt_commitment' else a.effect_kind end category,
      case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end::text beneficiary_key,
      case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end::text payer_key
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    left join finance.budget_allocations original on a.effect_kind='refund' and original.household_id=a.household_id and original.id=a.original_refund_allocation_id
    where a.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review')
      and (scope is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_scope else a.beneficiary_scope end)=scope)
      and (bm is null or (case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end)=bm)
      and (pm is null or (case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end)=pm)
  ), bg as (select coalesce(beneficiary_key,'shared') entity,category,finance.budget_json_cents(sum(amount_cents)) amount from attributed group by 1,2),
  pg as (select coalesce(payer_key,'unassigned') entity,category,finance.budget_json_cents(sum(amount_cents)) amount from attributed group by 1,2),
  b as (select entity,jsonb_object_agg(category,amount) groups from bg group by entity),
  p as (select entity,jsonb_object_agg(category,amount) groups from pg group by entity)
  select coalesce((select jsonb_object_agg(entity,groups) from b),'{}'::jsonb),
    coalesce((select jsonb_object_agg(entity,groups) from p),'{}'::jsonb) into benf,payf;
  with attributed as (
    select a.amount_cents,
      case when a.effect_kind in ('required_debt_payment','extra_debt_payment') then 'debt_commitment' else a.effect_kind end category,
      case when a.effect_kind='refund' and original.id is not null then original.beneficiary_member_id else a.beneficiary_member_id end::text beneficiary_key,
      case when a.effect_kind='refund' and original.id is not null then original.paid_by_member_id else a.paid_by_member_id end::text payer_key
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    left join finance.budget_allocations original on a.effect_kind='refund' and original.household_id=a.household_id and original.id=a.original_refund_allocation_id
    where a.household_id=h and s.occurred_on>=f and s.occurred_on<t and s.status in ('current','needs_review')
  ), bg as (select coalesce(beneficiary_key,'shared') entity,category,finance.budget_json_cents(sum(amount_cents)) amount from attributed group by 1,2),
  pg as (select coalesce(payer_key,'unassigned') entity,category,finance.budget_json_cents(sum(amount_cents)) amount from attributed group by 1,2),
  b as (select entity,jsonb_object_agg(category,amount) groups from bg group by entity),
  p as (select entity,jsonb_object_agg(category,amount) groups from pg group by entity)
  select coalesce((select jsonb_object_agg(entity,groups) from b),'{}'::jsonb),
    coalesce((select jsonb_object_agg(entity,groups) from p),'{}'::jsonb) into benh,payh;
  filtered:=jsonb_build_object('by_group',filtered,'by_beneficiary',benf,'by_actual_payer',payf);
  household:=jsonb_build_object('by_group',household,'by_beneficiary',benh,'by_actual_payer',payh);
  return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',statement_timestamp(),'complete',availability_complete,'reasons',availability_reasons,'filters',p_filters,'entries',rows,'filtered_totals',filtered,'household_totals',household,'next_cursor',next_cursor);
end $$;

create or replace function public.budget_get_review_queue_v1(p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; c jsonb; rows jsonb:='[]'; r record; n int:=0; next_cursor text; last_key text; resources jsonb; queue_present boolean:=false;
begin
 h:=finance.budget_reader_household(); if p_limit is null or p_limit not between 1 and 200 then perform finance.budget_fail('budget_invalid','invalid limit'); end if; resources:=finance.budget_resources(h,statement_timestamp());
 if p_cursor is not null then begin c:=finance.budget_cursor_validate(p_cursor,'review',h,array['review_key']); last_key:=c->>'review_key'; if last_key is null then perform finance.budget_fail('budget_invalid','invalid cursor'); end if; exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end; end if;
 for r in with items as (
   select s.id set_id,a.id allocation_id,s.id::text||':'||a.id::text review_key,'allocation' kind,'high' severity,s.occurred_on,a.fund_id,a.amount_cents,s.transaction_id,s.utility_entry_id,null::uuid account_id,jsonb_build_array(jsonb_build_object('code','allocation_needs_review')) reasons,jsonb_build_object('set_id',s.id,'allocation_id',a.id,'status',s.status) provenance from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status='needs_review'
   union all select null,null,'transaction:'||t.id,'unallocated_outflow','high',t.occurred_on,null,(snap->>'amount_cents')::numeric,t.id,null,t.account_id,jsonb_build_array(jsonb_build_object('code','unallocated_outflow')),jsonb_build_object('source_system',t.source_system,'source_snapshot',snap) from public.transactions t cross join lateral finance.budget_source_snapshot(h,t.id) snap where t.household_id=h and (snap->>'amount_cents')::numeric<0 and t.source_is_pending is false and t.source_is_archived is false and (finance.budget_opening_cutover(h) is null or t.occurred_on>=finance.budget_opening_cutover(h)) and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.transaction_id=t.id and s.status in ('current','needs_review'))
   union all select s.id,a.id,'drift:'||s.id::text||':'||a.id::text,'source_drift','high',s.occurred_on,a.fund_id,a.amount_cents,s.transaction_id,s.utility_entry_id,null,jsonb_build_array(jsonb_build_object('code','source_fingerprint_drift')),jsonb_build_object('set_id',s.id,'allocation_id',a.id,'frozen_fingerprint',s.source_fingerprint,'current_fingerprint',finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint') from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status in ('current','needs_review') and s.transaction_id is not null and s.source_fingerprint is distinct from finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint'
   union all select s.id,a.id,'utility-drift:'||s.id::text||':'||a.id::text,'source_drift','high',s.occurred_on,a.fund_id,a.amount_cents,null,s.utility_entry_id,null,jsonb_build_array(jsonb_build_object('code','source_fingerprint_drift')),jsonb_build_object('set_id',s.id,'allocation_id',a.id,'frozen_fingerprint',s.source_fingerprint,'current_fingerprint',finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint') from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status in ('current','needs_review') and s.utility_entry_id is not null and s.source_fingerprint is distinct from finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint'
   union all select null,null,'utility:'||l.id::text,'utility_unlinked','medium',coalesce(l.occurred_at,l.posted_at)::date,null,case when l.direction='debit' then -(l.amount*100) else l.amount*100 end,l.metadata->>'transaction_id',l.id,null,jsonb_build_array(jsonb_build_object('code','utility_unlinked')),jsonb_build_object('source',l.source,'source_record_id',l.source_record_id) from consumption.ledger_entries l where l.household_id=h and l.entry_type in ('usage_charge','fee','correction') and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.utility_entry_id=l.id and s.status in ('current','needs_review'))
   union all select null,null,'resource:'||coalesce(x.value->>'code','unknown')||':'||h::text,'resource_reason','high',null,null,null,null,null,null,jsonb_build_array(x.value),jsonb_build_object('resource_state',resources) from jsonb_array_elements(coalesce(resources->'reasons','[]'::jsonb)) x(value)
 ) select * from items where (last_key is null or review_key<last_key) order by review_key desc limit p_limit+1 loop
   n:=n+1; if n>p_limit then next_cursor:=finance.budget_cursor_encode(jsonb_build_object('v',1,'kind','review','household_id',h::text,'review_key',last_key)); exit; end if; last_key:=r.review_key; rows:=rows||jsonb_build_array(jsonb_build_object('review_key',r.review_key,'kind',r.kind,'severity',r.severity,'occurred_on',r.occurred_on,'source_transaction_id',r.transaction_id,'utility_entry_id',r.utility_entry_id,'account_id',r.account_id,'fund_id',r.fund_id,'amount_cents',case when r.amount_cents is null then null else r.amount_cents::numeric::bigint::text end,'impact_cents',case when r.amount_cents is null then null else r.amount_cents::numeric::bigint::text end,'reasons',r.reasons,'provenance',r.provenance)); end loop;
 queue_present:=jsonb_array_length(coalesce(resources->'reasons','[]'::jsonb))>0
   or exists(select 1 from finance.budget_allocation_sets where household_id=h and status='needs_review')
   or exists(select 1 from public.transactions t cross join lateral finance.budget_source_snapshot(h,t.id) snap where t.household_id=h and (snap->>'amount_cents')::numeric<0 and t.source_is_pending is false and t.source_is_archived is false and (finance.budget_opening_cutover(h) is null or t.occurred_on>=finance.budget_opening_cutover(h)) and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.transaction_id=t.id and s.status in ('current','needs_review')))
   or exists(select 1 from consumption.ledger_entries l where l.household_id=h and l.entry_type in ('usage_charge','fee','correction') and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.utility_entry_id=l.id and s.status in ('current','needs_review')))
   or exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.status in ('current','needs_review') and ((s.transaction_id is not null and s.source_fingerprint is distinct from finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint') or (s.utility_entry_id is not null and s.source_fingerprint is distinct from finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint')));
 return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',statement_timestamp(),'complete',coalesce((resources->>'complete')::boolean,false) and not queue_present,'reasons',coalesce(resources->'reasons','[]'::jsonb)||(case when queue_present then jsonb_build_array(jsonb_build_object('code','review_items_present')) else '[]'::jsonb end),'entries',rows,'items',rows,'next_cursor',next_cursor);
end $$;

create or replace function public.budget_get_liquidity_v1(p_as_of timestamptz default now(),p_horizon_days integer default 45)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; r jsonb; end_date date; start_date date; v uuid; forecast_entries jsonb:='[]'; account_rows jsonb:='[]'; x record; reasons jsonb:='[]'; complete boolean; expected_income numeric:=0; expected_payment numeric:=0; card_debt numeric:=0; income_known boolean:=true;
begin
 h:=finance.budget_reader_household(); if p_as_of is null or p_as_of>statement_timestamp() or p_horizon_days is null or p_horizon_days not between 1 and 366 then perform finance.budget_fail('budget_invalid','invalid liquidity bounds'); end if;
 r:=finance.budget_resources(h,p_as_of); start_date:=(p_as_of at time zone 'Africa/Johannesburg')::date; end_date:=start_date+p_horizon_days;
 for x in select q.value as a from jsonb_array_elements(coalesce(r->'accounts','[]'::jsonb)) q(value) loop
   if x.a->>'status'='included' then
     account_rows:=account_rows||jsonb_build_array(jsonb_build_object('account_id',x.a->>'account_id','owner_scope',x.a->'settings_snapshot'->>'owner_scope','owner_member_id',x.a->'settings_snapshot'->>'owner_member_id','resource_class',coalesce(x.a->>'resource_class',x.a->'settings_snapshot'->>'resource_class'),'normalized_cash_cents',x.a->>'normalized_cash_cents','normalized_debt_cents',x.a->>'normalized_debt_cents','source_balance_provenance',jsonb_build_object('reconciliation_id',r->>'reconciliation_id','fingerprint',r->>'reconciliation_fingerprint')));
     if x.a->'settings_snapshot'->>'resource_class'='card' and x.a->>'normalized_debt_cents' is not null then card_debt:=card_debt+(x.a->>'normalized_debt_cents')::numeric; end if;
   end if;
 end loop;
 select nullif(finance.budget_plan_versions(h,finance.budget_cycle_start((p_as_of at time zone 'Africa/Johannesburg')::date),p_as_of)->>'current_version_id','')::uuid into v;
 if v is not null then
   for x in select l.expected_payment_on date,l.expected_payment_account_id account_id,l.contribution_cents cents,l.beneficiary_member_id,l.planned_payer_member_id,l.id line_id from finance.budget_lines l where l.household_id=h and l.version_id=v and l.expected_payment_on is not null and l.expected_payment_on between start_date and end_date loop expected_payment:=expected_payment+x.cents; forecast_entries:=forecast_entries||jsonb_build_array(jsonb_build_object('kind','payment','date',x.date,'amount_cents',x.cents::text,'amount_basis','planned_contribution','account_id',x.account_id,'beneficiary_member_id',x.beneficiary_member_id,'planned_payer_member_id',x.planned_payer_member_id,'provenance',jsonb_build_object('budget_version_id',v,'line_id',x.line_id))); end loop;
   for x in select i.value as income from finance.budget_versions bv cross join lateral jsonb_array_elements(bv.income_assumptions) i where bv.household_id=h and bv.id=v loop
     if coalesce(x.income->>'date',x.income->>'expected_on') is null or (coalesce(x.income->>'date',x.income->>'expected_on'))::date between start_date and end_date then
       if x.income->>'expected_net_cents' is null then income_known:=false; else expected_income:=expected_income+(x.income->>'expected_net_cents')::numeric; forecast_entries:=forecast_entries||jsonb_build_array(jsonb_build_object('kind','income','date',coalesce(x.income->>'date',x.income->>'expected_on'),'amount_cents',(x.income->>'expected_net_cents'),'amount_basis','income_assumption','account_id',x.income->'account_id','beneficiary_member_id',x.income->'beneficiary_member_id','planned_payer_member_id',x.income->'payer_member_id','provenance',jsonb_build_object('budget_version_id',v))); end if;
     end if;
   end loop;
 else reasons:=reasons||jsonb_build_array(jsonb_build_object('code','plan_missing')); income_known:=false; end if;
 complete:=coalesce((r->>'complete')::boolean,false) and v is not null;
 return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',p_as_of,'complete',complete,'reasons',coalesce(r->'reasons','[]')||reasons,'accounts',account_rows,'card_debt_cents',case when card_debt is null then null else finance.budget_checked_bigint(card_debt)::text end,'observed',r,'resources',r,'restricted_resources',coalesce(r->'restricted_resources','[]'::jsonb),'restricted_claims',coalesce(r->'restricted_claims','[]'::jsonb),'pending_adjustments',coalesce(r->'pending_adjustments','[]'::jsonb),'forecast',jsonb_build_object('horizon_days',p_horizon_days,'through_date',end_date,'entries',forecast_entries,'expected_income_cents',case when income_known then finance.budget_checked_bigint(expected_income)::text else null end,'expected_payment_cents',finance.budget_checked_bigint(expected_payment)::text,'indicative_net_gap_cents',case when income_known then finance.budget_checked_bigint(expected_payment-expected_income)::text else null end,'uncertainty_reasons',case when income_known then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','income_assumption_unknown')) end),'expected',forecast_entries,'horizon_days',p_horizon_days,'indicative_net_gap_cents',case when income_known then finance.budget_checked_bigint(expected_payment-expected_income)::text else null end);
end $$;

revoke all on function public.budget_list_versions_v1(text,integer),public.budget_get_version_v1(uuid),public.budget_get_actuals_v1(jsonb,text,integer),public.budget_get_review_queue_v1(text,integer),public.budget_get_liquidity_v1(timestamptz,integer) from public,anon,service_role;
grant execute on function public.budget_list_versions_v1(text,integer),public.budget_get_version_v1(uuid),public.budget_get_actuals_v1(jsonb,text,integer),public.budget_get_review_queue_v1(text,integer),public.budget_get_liquidity_v1(timestamptz,integer) to authenticated;
revoke all on function finance.budget_cursor_encode(jsonb),finance.budget_cursor_decode(text),finance.budget_cursor_validate(text,text,uuid,text[]),finance.budget_json_cents(numeric) from public,anon,authenticated,service_role;

-- Preserve Stage 4 bodies privately while making the final wrappers additive.
alter function public.budget_get_overview_v1(date,timestamptz) set schema finance;
alter function finance.budget_get_overview_v1(date,timestamptz) rename to budget_get_overview_v1_stage4;
alter function public.budget_get_fund_v1(uuid,date,date,text,integer) set schema finance;
alter function finance.budget_get_fund_v1(uuid,date,date,text,integer) rename to budget_get_fund_v1_stage4;

create or replace function public.budget_get_overview_v1(p_cycle_start date,p_as_of timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; v jsonb; res jsonb;
begin v:=finance.budget_get_overview_v1_stage4(p_cycle_start,p_as_of); h:=finance.budget_reader_household(); res:=finance.budget_resources(h,p_as_of); return v||jsonb_build_object('query_provenance',jsonb_build_object('resources',res,'restricted_resources',res->'restricted_resources','restricted_claims',res->'restricted_claims','pending_adjustments',res->'pending_adjustments')); end $$;

create or replace function public.budget_get_fund_v1(p_fund_id uuid,p_from date,p_to date,p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare v jsonb; h uuid; res jsonb;
begin v:=finance.budget_get_fund_v1_stage4(p_fund_id,p_from,p_to,p_cursor,p_limit); h:=finance.budget_reader_household(); res:=finance.budget_resources(h,least(statement_timestamp(),(p_to::timestamp at time zone 'Africa/Johannesburg')-interval '1 microsecond')); return v||jsonb_build_object('entries',coalesce((select jsonb_agg(e||jsonb_build_object('lineage',jsonb_build_object('source_transaction_id',e->'source_transaction_id','utility_entry_id',e->'utility_entry_id','correction_of',e->'correction_of','original_refund_allocation_id',e->'original_refund_allocation_id','financial_event_id',e->'financial_event_id')) order by ord) from jsonb_array_elements(coalesce(v->'entries','[]'::jsonb)) with ordinality x(e,ord)),'[]'::jsonb),'query_provenance',jsonb_build_object('resources',res,'pending_adjustments',res->'pending_adjustments')); end $$;

revoke all on function finance.budget_get_overview_v1_stage4(date,timestamptz),finance.budget_get_fund_v1_stage4(uuid,date,date,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.budget_get_overview_v1(date,timestamptz),public.budget_get_fund_v1(uuid,date,date,text,integer) from public,anon,service_role;
grant execute on function public.budget_get_overview_v1(date,timestamptz),public.budget_get_fund_v1(uuid,date,date,text,integer) to authenticated;
