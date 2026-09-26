create extension if not exists pg_trgm;

create index if not exists transactions_household_feed_idx
  on public.transactions (household_id, date desc, id desc)
  where source_is_archived is not true;

create index if not exists transaction_classifications_lookup_idx
  on finance.transaction_classifications (transaction_id, status, created_at desc);

create index if not exists transaction_treatments_lookup_idx
  on finance.transaction_treatments (transaction_id, status, created_at desc);

create index if not exists classification_runs_transaction_idx
  on finance.classification_runs (transaction_id, completed_at desc);

create unique index if not exists transaction_classifications_one_proposed
  on finance.transaction_classifications (transaction_id)
  where status = 'proposed';

create unique index if not exists transaction_treatments_one_proposed
  on finance.transaction_treatments (transaction_id)
  where status = 'proposed';

create index if not exists transactions_search_trgm_idx
  on public.transactions
  using gin ((
    coalesce(merchant_name, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(original_description, '')
  ) gin_trgm_ops);

alter table finance.classification_feedback
  add column if not exists reviewed_classification_id uuid references finance.transaction_classifications(id),
  add column if not exists reviewed_treatment_id uuid references finance.transaction_treatments(id),
  add column if not exists run_id uuid references finance.classification_runs(id);

alter table finance.classification_feedback
  drop constraint if exists classification_feedback_action_check;

alter table finance.classification_feedback
  add constraint classification_feedback_action_check
  check (action in ('approved', 'rejected', 'corrected', 'manual', 'undo'));

create or replace function finance.map_decision_provenance(p_source text)
returns text
language sql
immutable
as $$
  select case p_source
    when 'user' then 'user'
    when 'policy' then 'policy'
    when 'jev' then 'jev'
    when 'agent' then 'agent'
    when 'imported' then 'policy'
    when 'rule' then 'policy'
    else 'none'
  end
$$;

create or replace function finance.resolve_caller_household()
returns uuid
language plpgsql
stable
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_role text;
  v_id uuid;
  v_count integer;
begin
  v_role := coalesce(
    auth.jwt() ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role = 'service_role' then
    select count(*) into v_count from finance.households;
    if v_count <> 1 then
      raise exception 'service role requires a single household';
    end if;
    select id into v_id from finance.households limit 1;
    return v_id;
  end if;

  select member.household_id into v_id
  from finance.household_members as member
  where member.auth_user_id = auth.uid()
     or lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by member.created_at
  limit 1;

  if v_id is null then
    raise exception 'not a household member';
  end if;
  return v_id;
end;
$$;

create or replace function finance.resolve_reviewer_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'reviewer identity is not available';
  end if;
  return v_actor;
end;
$$;

create or replace function finance.transaction_feed_item(p_transaction_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, finance, pg_temp
as $$
  with tx as (
    select *
    from public.transactions
    where id = p_transaction_id
  ),
  confirmed as (
    select *
    from finance.transaction_classifications
    where transaction_id = p_transaction_id
      and status = 'confirmed'
    limit 1
  ),
  proposed as (
    select *
    from finance.transaction_classifications
    where transaction_id = p_transaction_id
      and status = 'proposed'
    order by created_at desc
    limit 1
  ),
  mapped as (
    select sc.owned_category_id, c.name as owned_name
    from tx
    join finance.source_categories sc
      on sc.household_id = tx.household_id
     and sc.source_system = tx.source_system
     and sc.source_category_id = tx.source_category_id
    left join finance.categories c on c.id = sc.owned_category_id
    limit 1
  ),
  confirmed_category as (
    select c.id, c.name
    from confirmed
    join finance.categories c on c.id = confirmed.category_id
  ),
  proposed_category as (
    select c.id, c.name
    from proposed
    join finance.categories c on c.id = proposed.category_id
  ),
  confirmed_treatment as (
    select *
    from finance.transaction_treatments
    where transaction_id = p_transaction_id
      and status = 'confirmed'
    limit 1
  ),
  proposed_treatment as (
    select *
    from finance.transaction_treatments
    where transaction_id = p_transaction_id
      and status = 'proposed'
    order by created_at desc
    limit 1
  ),
  latest_run as (
    select *
    from finance.classification_runs
    where transaction_id = p_transaction_id
    order by completed_at desc nulls last, started_at desc
    limit 1
  ),
  active_event as (
    select e.id, e.event_type, e.status, l.leg_role
    from finance.financial_event_legs l
    join finance.financial_events e on e.id = l.event_id
    where l.transaction_id = p_transaction_id
      and l.status = 'active'
      and e.status <> 'superseded'
    limit 1
  )
  select jsonb_build_object(
    'id', tx.id,
    'occurredAt', tx.date,
    'occurredOn', tx.occurred_on,
    'description', coalesce(tx.description, tx.merchant_name, 'Untitled movement'),
    'originalDescription', tx.original_description,
    'amount', tx.amount::text,
    'currencyCode', tx.currency_code,
    'merchant', jsonb_build_object(
      'id', tx.merchant_source_id,
      'name', tx.merchant_name
    ),
    'account', jsonb_build_object(
      'id', a.account_id,
      'name', a.name,
      'type', coalesce(a.account_type, a.type)
    ),
    'source', jsonb_build_object(
      'system', tx.source_system,
      'categoryId', tx.source_category_id,
      'categoryName', tx.source_category_name_snapshot,
      'isTransfer', tx.source_is_transfer,
      'isPending', tx.source_is_pending,
      'isArchived', coalesce(tx.source_is_archived, false),
      'lastSeenAt', tx.source_last_seen_at
    ),
    'category', jsonb_build_object(
      'id', coalesce(confirmed_category.id, proposed_category.id, mapped.owned_category_id),
      'name', coalesce(
        confirmed_category.name,
        proposed_category.name,
        mapped.owned_name,
        tx.source_category_name_snapshot
      ),
      'provenance', case
        when confirmed.id is not null then finance.map_decision_provenance(confirmed.decision_source)
        when proposed.id is not null then finance.map_decision_provenance(proposed.decision_source)
        when mapped.owned_category_id is not null or tx.source_category_name_snapshot is not null then 'source'
        else 'none'
      end,
      'state', case
        when confirmed.id is not null then 'confirmed'
        when proposed.id is not null then 'proposed'
        when mapped.owned_category_id is not null or tx.source_category_name_snapshot is not null then 'source_only'
        else 'unclassified'
      end,
      'confidence', coalesce(confirmed.confidence, proposed.confidence, (latest_run.result->>'confidence')::numeric),
      'proposalDiffersFromSource', proposed.id is not null
        and proposed.category_id is distinct from mapped.owned_category_id
    ),
    'treatment', jsonb_build_object(
      'isTransfer', case
        when confirmed_treatment.id is not null then confirmed_treatment.is_transfer
        when proposed_treatment.id is not null then proposed_treatment.is_transfer
        else tx.source_is_transfer
      end,
      'excludeFromSpend', case
        when confirmed_treatment.id is not null then confirmed_treatment.exclude_from_spend
        when proposed_treatment.id is not null then proposed_treatment.exclude_from_spend
        else null
      end,
      'nature', case
        when confirmed_treatment.id is not null then confirmed_treatment.nature
        when proposed_treatment.id is not null then proposed_treatment.nature
        else null
      end,
      'provenance', case
        when confirmed_treatment.id is not null then finance.map_decision_provenance(confirmed_treatment.decision_source)
        when proposed_treatment.id is not null then finance.map_decision_provenance(proposed_treatment.decision_source)
        when tx.source_is_transfer is not null then 'source'
        else 'none'
      end,
      'state', case
        when confirmed_treatment.id is not null then 'confirmed'
        when proposed_treatment.id is not null then 'proposed'
        when tx.source_is_transfer is not null then 'source_only'
        else 'unknown'
      end
    ),
    'classifier', jsonb_build_object(
      'runId', latest_run.id,
      'classifier', latest_run.classifier,
      'classifierVersion', latest_run.classifier_version,
      'modelId', latest_run.model_id,
      'completedAt', latest_run.completed_at,
      'confidence', (latest_run.result->>'confidence')::numeric,
      'margin', (latest_run.result->>'margin')::numeric,
      'topProbability', coalesce(
        (latest_run.result->>'topProbability')::numeric,
        (latest_run.result->>'top_probability')::numeric
      ),
      'accepted', coalesce(
        (latest_run.result->>'accept')::boolean,
        (latest_run.result->>'accepted')::boolean
      ),
      'state', case
        when latest_run.id is null then 'not_run'
        when latest_run.status = 'failed' then 'failed'
        when latest_run.status = 'succeeded'
          and coalesce((latest_run.result->>'abstained')::boolean, false) then 'abstained'
        when latest_run.status = 'succeeded'
          and proposed.id is null
          and confirmed.id is null then 'abstained'
        when latest_run.status = 'succeeded' then 'succeeded'
        else 'not_run'
      end
    ),
    'event', case
      when active_event.id is null then null
      else jsonb_build_object(
        'id', active_event.id,
        'type', active_event.event_type,
        'role', active_event.leg_role,
        'status', active_event.status
      )
    end,
    'reviewState', case
      when confirmed.id is not null then 'confirmed'
      when proposed.id is not null
        and mapped.owned_category_id is not null
        and proposed.category_id = mapped.owned_category_id then 'jev_agrees'
      when proposed.id is not null
        and mapped.owned_category_id is not null then 'jev_disagrees'
      when proposed.id is not null then 'jev_proposed'
      when latest_run.status = 'failed' then 'classifier_failed'
      when latest_run.status = 'succeeded' and proposed.id is null then 'classifier_abstained'
      when mapped.owned_category_id is null and tx.source_category_name_snapshot is null then 'unclassified'
      when latest_run.id is null then 'awaiting_classifier'
      else 'unclassified'
    end,
    'revision', jsonb_build_object(
      'confirmedClassificationId', confirmed.id,
      'proposedClassificationId', proposed.id,
      'confirmedTreatmentId', confirmed_treatment.id,
      'proposedTreatmentId', proposed_treatment.id
    )
  )
  from tx
  join public.accounts a on a.account_id = tx.account_id
  left join confirmed on true
  left join proposed on true
  left join mapped on true
  left join confirmed_category on true
  left join proposed_category on true
  left join confirmed_treatment on true
  left join proposed_treatment on true
  left join latest_run on true
  left join active_event on true
$$;

create or replace function finance.encode_transaction_cursor(
  p_date timestamptz,
  p_id text
) returns text
language sql
immutable
as $$
  select encode(
    convert_to(jsonb_build_object('d', p_date, 'i', p_id)::text, 'utf8'),
    'base64'
  )
$$;

create or replace function public.finance_list_transactions_v1(
  p_cursor text default null,
  p_limit integer default 50,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_filters jsonb;
  v_limit integer;
  v_cursor_date timestamptz;
  v_cursor_id text;
  v_from date;
  v_to date;
  v_account uuid;
  v_category uuid;
  v_review text;
  v_source text;
  v_transfer text;
  v_spend text;
  v_direction text;
  v_search text;
  v_archived boolean;
  v_computed boolean;
  v_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_last_date timestamptz;
  v_last_id text;
  v_row record;
begin
  v_household := finance.resolve_caller_household();
  v_filters := coalesce(p_filters, '{}'::jsonb);
  if jsonb_typeof(v_filters) is distinct from 'object' then
    raise exception 'filters must be an object';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  if p_cursor is not null and btrim(p_cursor) <> '' then
    begin
      v_cursor_date := (convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb->>'d')::timestamptz;
      v_cursor_id := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb->>'i';
    exception when others then
      raise exception 'invalid cursor';
    end;
    if v_cursor_date is null or v_cursor_id is null then
      raise exception 'invalid cursor';
    end if;
  end if;

  if nullif(v_filters->>'fromDate', '') is not null then
    v_from := (v_filters->>'fromDate')::date;
  end if;
  if nullif(v_filters->>'toDate', '') is not null then
    v_to := (v_filters->>'toDate')::date;
  end if;
  if nullif(v_filters->>'accountId', '') is not null then
    v_account := (v_filters->>'accountId')::uuid;
  end if;
  if nullif(v_filters->>'categoryId', '') is not null then
    v_category := (v_filters->>'categoryId')::uuid;
  end if;
  v_review := nullif(v_filters->>'reviewState', '');
  if v_review is not null and v_review not in (
    'confirmed', 'jev_agrees', 'jev_disagrees', 'jev_proposed', 'unclassified',
    'awaiting_classifier', 'classifier_abstained', 'classifier_failed'
  ) then
    raise exception 'unknown review state';
  end if;
  v_source := nullif(v_filters->>'sourceSystem', '');
  v_transfer := nullif(v_filters->>'transfer', '');
  if v_transfer is not null and v_transfer not in ('yes', 'no', 'unknown') then
    raise exception 'unknown transfer filter';
  end if;
  v_spend := nullif(v_filters->>'spend', '');
  if v_spend is not null and v_spend not in ('included', 'excluded', 'unknown') then
    raise exception 'unknown spend filter';
  end if;
  v_direction := nullif(v_filters->>'direction', '');
  if v_direction is not null and v_direction not in ('debit', 'credit') then
    raise exception 'unknown direction';
  end if;
  v_search := nullif(left(btrim(coalesce(v_filters->>'search', '')), 200), '');
  if v_search is not null then
    v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  v_archived := coalesce((v_filters->>'archived')::boolean, false);
  v_computed := v_category is not null
    or v_review is not null
    or v_transfer is not null
    or v_spend is not null;

  if v_computed then
    for v_row in
      select t.id, t.date
      from public.transactions t
      left join lateral (
        select id, category_id
        from finance.transaction_classifications
        where transaction_id = t.id and status = 'confirmed'
        limit 1
      ) confirmed on true
      left join lateral (
        select id, category_id
        from finance.transaction_classifications
        where transaction_id = t.id and status = 'proposed'
        order by created_at desc
        limit 1
      ) proposed on true
      left join lateral (
        select owned_category_id
        from finance.source_categories
        where household_id = t.household_id
          and source_system = t.source_system
          and source_category_id = t.source_category_id
        limit 1
      ) mapped on true
      left join lateral (
        select status
        from finance.classification_runs
        where transaction_id = t.id
        order by completed_at desc nulls last, started_at desc
        limit 1
      ) latest_run on true
      left join lateral (
        select is_transfer, exclude_from_spend
        from finance.transaction_treatments
        where transaction_id = t.id and status = 'confirmed'
        limit 1
      ) confirmed_treatment on true
      left join lateral (
        select is_transfer, exclude_from_spend
        from finance.transaction_treatments
        where transaction_id = t.id and status = 'proposed'
        order by created_at desc
        limit 1
      ) proposed_treatment on true
      where t.household_id = v_household
        and (
          (not v_archived and t.source_is_archived is not true)
          or (v_archived and t.source_is_archived is true)
        )
        and (
          v_cursor_date is null
          or (t.date, t.id) < (v_cursor_date, v_cursor_id)
        )
        and (v_account is null or t.account_id = v_account)
        and (v_from is null or t.occurred_on >= v_from)
        and (v_to is null or t.occurred_on <= v_to)
        and (v_source is null or t.source_system = v_source)
        and (
          v_direction is null
          or (v_direction = 'debit' and t.amount < 0)
          or (v_direction = 'credit' and t.amount > 0)
        )
        and (
          v_search is null
          or (
            coalesce(t.merchant_name, '') || ' ' ||
            coalesce(t.description, '') || ' ' ||
            coalesce(t.original_description, '')
          ) ilike '%' || v_search || '%' escape '\'
        )
        and (
          v_category is null
          or coalesce(confirmed.category_id, proposed.category_id, mapped.owned_category_id) = v_category
        )
        and (
          v_review is null
          or v_review = case
            when confirmed.id is not null then 'confirmed'
            when proposed.id is not null
              and mapped.owned_category_id is not null
              and proposed.category_id = mapped.owned_category_id then 'jev_agrees'
            when proposed.id is not null
              and mapped.owned_category_id is not null then 'jev_disagrees'
            when proposed.id is not null then 'jev_proposed'
            when latest_run.status = 'failed' then 'classifier_failed'
            when latest_run.status = 'succeeded' and proposed.id is null then 'classifier_abstained'
            when mapped.owned_category_id is null and t.source_category_name_snapshot is null then 'unclassified'
            when latest_run.status is null then 'awaiting_classifier'
            else 'unclassified'
          end
        )
        and (
          v_transfer is null
          or v_transfer = case
            when confirmed_treatment.is_transfer is not null then
              case when confirmed_treatment.is_transfer then 'yes' else 'no' end
            when proposed_treatment.is_transfer is not null then
              case when proposed_treatment.is_transfer then 'yes' else 'no' end
            when t.source_is_transfer is not null then
              case when t.source_is_transfer then 'yes' else 'no' end
            else 'unknown'
          end
        )
        and (
          v_spend is null
          or v_spend = case
            when confirmed_treatment.exclude_from_spend is not null then
              case when confirmed_treatment.exclude_from_spend then 'excluded' else 'included' end
            when proposed_treatment.exclude_from_spend is not null then
              case when proposed_treatment.exclude_from_spend then 'excluded' else 'included' end
            else 'unknown'
          end
        )
      order by t.date desc, t.id desc
      limit v_limit + 1
    loop
      v_count := v_count + 1;
      if v_count <= v_limit then
        v_items := v_items || finance.transaction_feed_item(v_row.id);
        v_last_date := v_row.date;
        v_last_id := v_row.id;
      end if;
    end loop;
  else
    for v_row in
      select t.id, t.date
      from public.transactions t
      where t.household_id = v_household
        and (
          (not v_archived and t.source_is_archived is not true)
          or (v_archived and t.source_is_archived is true)
        )
        and (
          v_cursor_date is null
          or (t.date, t.id) < (v_cursor_date, v_cursor_id)
        )
        and (v_account is null or t.account_id = v_account)
        and (v_from is null or t.occurred_on >= v_from)
        and (v_to is null or t.occurred_on <= v_to)
        and (v_source is null or t.source_system = v_source)
        and (
          v_direction is null
          or (v_direction = 'debit' and t.amount < 0)
          or (v_direction = 'credit' and t.amount > 0)
        )
        and (
          v_search is null
          or (
            coalesce(t.merchant_name, '') || ' ' ||
            coalesce(t.description, '') || ' ' ||
            coalesce(t.original_description, '')
          ) ilike '%' || v_search || '%' escape '\'
        )
      order by t.date desc, t.id desc
      limit v_limit + 1
    loop
      v_count := v_count + 1;
      if v_count <= v_limit then
        v_items := v_items || finance.transaction_feed_item(v_row.id);
        v_last_date := v_row.date;
        v_last_id := v_row.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'nextCursor', case
      when v_count > v_limit then finance.encode_transaction_cursor(v_last_date, v_last_id)
      else null
    end
  );
end;
$$;

create or replace function public.finance_get_transaction_v1(p_transaction_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_item jsonb;
  v_classifications jsonb;
  v_treatments jsonb;
  v_runs jsonb;
  v_observations jsonb;
  v_legs jsonb;
begin
  if nullif(btrim(p_transaction_id), '') is null then
    raise exception 'transaction is required';
  end if;
  v_household := finance.resolve_caller_household();
  if not exists (
    select 1 from public.transactions
    where id = p_transaction_id and household_id = v_household
  ) then
    raise exception 'transaction not found';
  end if;

  v_item := finance.transaction_feed_item(p_transaction_id);

  select coalesce(jsonb_agg(h.item order by h.sort_at desc), '[]'::jsonb)
  into v_classifications
  from (
    select
      c.created_at as sort_at,
      jsonb_build_object(
        'id', c.id,
        'categoryId', c.category_id,
        'categoryName', cat.name,
        'decisionSource', c.decision_source,
        'status', c.status,
        'confidence', c.confidence,
        'reason', c.reason,
        'createdAt', c.created_at,
        'confirmedAt', c.confirmed_at,
        'supersededAt', c.superseded_at,
        'runId', c.run_id
      ) as item
    from finance.transaction_classifications c
    join finance.categories cat on cat.id = c.category_id
    where c.transaction_id = p_transaction_id
      and c.household_id = v_household
    order by c.created_at desc
    limit 12
  ) h;

  select coalesce(jsonb_agg(h.item order by h.sort_at desc), '[]'::jsonb)
  into v_treatments
  from (
    select
      tr.created_at as sort_at,
      jsonb_build_object(
        'id', tr.id,
        'isTransfer', tr.is_transfer,
        'excludeFromSpend', tr.exclude_from_spend,
        'nature', tr.nature,
        'decisionSource', tr.decision_source,
        'status', tr.status,
        'legRole', tr.leg_role,
        'createdAt', tr.created_at,
        'supersededAt', tr.superseded_at
      ) as item
    from finance.transaction_treatments tr
    where tr.transaction_id = p_transaction_id
      and tr.household_id = v_household
    order by tr.created_at desc
    limit 12
  ) h;

  select coalesce(jsonb_agg(h.item order by h.sort_at desc nulls last), '[]'::jsonb)
  into v_runs
  from (
    select
      r.completed_at as sort_at,
      jsonb_build_object(
        'id', r.id,
        'classifier', r.classifier,
        'classifierVersion', r.classifier_version,
        'modelId', r.model_id,
        'status', r.status,
        'startedAt', r.started_at,
        'completedAt', r.completed_at,
        'confidence', (r.result->>'confidence')::numeric,
        'margin', (r.result->>'margin')::numeric,
        'accepted', coalesce((r.result->>'accept')::boolean, (r.result->>'accepted')::boolean),
        'abstained', coalesce((r.result->>'abstained')::boolean, false),
        'categoryName', r.result->>'categoryName'
      ) as item
    from finance.classification_runs r
    where r.transaction_id = p_transaction_id
      and r.household_id = v_household
    order by r.completed_at desc nulls last, r.started_at desc
    limit 8
  ) h;

  select coalesce(jsonb_agg(h.item order by h.sort_at desc), '[]'::jsonb)
  into v_observations
  from (
    select
      o.observed_at as sort_at,
      jsonb_build_object(
        'id', o.id,
        'observedAt', o.observed_at,
        'sourceUpdatedAt', o.source_updated_at,
        'payloadHash', o.raw_payload_hash
      ) as item
    from finance.transaction_source_observations o
    where o.transaction_id = p_transaction_id
      and o.household_id = v_household
    order by o.observed_at desc
    limit 8
  ) h;

  select coalesce(jsonb_agg(h.item), '[]'::jsonb)
  into v_legs
  from (
    select jsonb_build_object(
      'transactionId', other.transaction_id,
      'role', other.leg_role,
      'description', tx.description,
      'amount', tx.amount::text,
      'currencyCode', tx.currency_code,
      'accountName', acc.name
    ) as item
    from finance.financial_event_legs mine
    join finance.financial_event_legs other
      on other.event_id = mine.event_id
     and other.status = 'active'
    join public.transactions tx on tx.id = other.transaction_id
    join public.accounts acc on acc.account_id = tx.account_id
    where mine.transaction_id = p_transaction_id
      and mine.status = 'active'
      and mine.household_id = v_household
    limit 12
  ) h;

  return v_item || jsonb_build_object(
    'history', jsonb_build_object(
      'classifications', v_classifications,
      'treatments', v_treatments,
      'runs', v_runs,
      'observations', v_observations,
      'eventLegs', v_legs
    )
  );
end;
$$;

create or replace function public.finance_get_transaction_filters_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
begin
  v_household := finance.resolve_caller_household();
  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.account_id,
        'name', a.name,
        'type', coalesce(a.account_type, a.type),
        'lifecycleStatus', a.lifecycle_status
      ) order by a.name)
      from public.accounts a
      where a.household_id = v_household
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'group', c.group_name,
        'slug', c.slug,
        'lifecycleStatus', c.lifecycle_status
      ) order by c.name)
      from finance.categories c
      where c.household_id = v_household
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.finance_get_transaction_activity_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_sync timestamptz;
  v_observed timestamptz;
  v_run record;
begin
  v_household := finance.resolve_caller_household();
  select max(completed_at) into v_sync
  from finance.sync_runs
  where household_id = v_household
    and source_system = 'finwise'
    and status = 'succeeded';
  select max(observed_at) into v_observed
  from finance.transaction_source_observations
  where household_id = v_household;
  select classifier, classifier_version, completed_at
  into v_run
  from finance.classification_runs
  where household_id = v_household
    and status = 'succeeded'
  order by completed_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'lastFinwiseSyncAt', v_sync,
    'lastSourceObservationAt', v_observed,
    'lastClassifierRunAt', v_run.completed_at,
    'classifier', v_run.classifier,
    'classifierVersion', v_run.classifier_version
  );
end;
$$;

create or replace function public.finance_set_transaction_category_v1(
  p_transaction_id text,
  p_category_id uuid,
  p_expected_confirmed_classification_id uuid,
  p_expected_proposed_classification_id uuid,
  p_review_command_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_actor uuid;
  v_confirmed uuid;
  v_proposed uuid;
  v_proposed_category uuid;
  v_proposed_run uuid;
  v_new_id uuid;
  v_action text;
begin
  if nullif(btrim(p_review_command_id), '') is null then
    raise exception 'review command is required';
  end if;
  if p_category_id is null then
    raise exception 'category is required';
  end if;
  v_household := finance.resolve_caller_household();
  v_actor := finance.resolve_reviewer_id();

  perform 1
  from public.transactions
  where id = p_transaction_id
    and household_id = v_household
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  if exists (
    select 1 from finance.classification_feedback
    where household_id = v_household
      and review_command_id = p_review_command_id
  ) then
    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  if not exists (
    select 1 from finance.categories
    where id = p_category_id
      and household_id = v_household
      and lifecycle_status = 'active'
  ) then
    raise exception 'category is not active';
  end if;

  select id into v_confirmed
  from finance.transaction_classifications
  where transaction_id = p_transaction_id
    and status = 'confirmed';
  select id, category_id, run_id
  into v_proposed, v_proposed_category, v_proposed_run
  from finance.transaction_classifications
  where transaction_id = p_transaction_id
    and status = 'proposed'
  order by created_at desc
  limit 1;

  if v_confirmed is distinct from p_expected_confirmed_classification_id
     or v_proposed is distinct from p_expected_proposed_classification_id then
    return jsonb_build_object(
      'conflict', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  if v_proposed is null then
    v_action := 'manual';
  elsif v_proposed_category = p_category_id then
    v_action := 'approved';
  else
    v_action := 'corrected';
  end if;

  update finance.transaction_classifications
  set status = 'superseded', superseded_at = now()
  where transaction_id = p_transaction_id
    and household_id = v_household
    and status = 'confirmed';

  update finance.transaction_classifications
  set status = 'superseded', superseded_at = now()
  where id = v_proposed
    and household_id = v_household
    and status = 'proposed';

  insert into finance.transaction_classifications (
    household_id,
    transaction_id,
    category_id,
    decision_source,
    status,
    actor_id,
    run_id,
    reason,
    confirmed_at
  ) values (
    v_household,
    p_transaction_id,
    p_category_id,
    'user',
    'confirmed',
    v_actor,
    null,
    'household review',
    now()
  )
  returning id into v_new_id;

  update public.transactions
  set owned_category_id = p_category_id, updated_at = now()
  where id = p_transaction_id
    and household_id = v_household;

  insert into finance.classification_feedback (
    household_id,
    transaction_id,
    review_command_id,
    reviewer_id,
    action,
    selected_category_id,
    reviewed_classification_id,
    run_id
  ) values (
    v_household,
    p_transaction_id,
    p_review_command_id,
    v_actor,
    v_action,
    p_category_id,
    v_proposed,
    v_proposed_run
  );

  raise log 'transaction_category_mutation %', jsonb_build_object(
    'transaction_id', p_transaction_id,
    'household_id', v_household,
    'review_command_id', p_review_command_id,
    'actor_id', v_actor,
    'previous_classification_id', v_confirmed,
    'new_classification_id', v_new_id,
    'action', v_action
  );

  return jsonb_build_object(
    'conflict', false,
    'idempotent', false,
    'item', finance.transaction_feed_item(p_transaction_id)
  );
end;
$$;

create or replace function public.finance_undo_transaction_category_v1(
  p_transaction_id text,
  p_category_id uuid,
  p_expected_confirmed_classification_id uuid,
  p_review_command_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_actor uuid;
  v_confirmed uuid;
  v_current_category uuid;
  v_new_id uuid;
begin
  if nullif(btrim(p_review_command_id), '') is null then
    raise exception 'review command is required';
  end if;
  v_household := finance.resolve_caller_household();
  v_actor := finance.resolve_reviewer_id();

  perform 1
  from public.transactions
  where id = p_transaction_id
    and household_id = v_household
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  if exists (
    select 1 from finance.classification_feedback
    where household_id = v_household
      and review_command_id = p_review_command_id
  ) then
    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  select id, category_id into v_confirmed, v_current_category
  from finance.transaction_classifications
  where transaction_id = p_transaction_id
    and status = 'confirmed';

  if v_confirmed is distinct from p_expected_confirmed_classification_id then
    return jsonb_build_object(
      'conflict', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  if p_category_id is not null and not exists (
    select 1 from finance.categories
    where id = p_category_id
      and household_id = v_household
      and lifecycle_status = 'active'
  ) then
    raise exception 'category is not active';
  end if;

  if p_category_id is not distinct from v_current_category and v_confirmed is not null then
    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  update finance.transaction_classifications
  set status = 'superseded', superseded_at = now()
  where id = v_confirmed
    and status = 'confirmed';

  if p_category_id is not null then
    insert into finance.transaction_classifications (
      household_id,
      transaction_id,
      category_id,
      decision_source,
      status,
      actor_id,
      reason,
      confirmed_at
    ) values (
      v_household,
      p_transaction_id,
      p_category_id,
      'user',
      'confirmed',
      v_actor,
      'undo',
      now()
    )
    returning id into v_new_id;
  end if;

  update public.transactions
  set owned_category_id = p_category_id, updated_at = now()
  where id = p_transaction_id
    and household_id = v_household;

  insert into finance.classification_feedback (
    household_id,
    transaction_id,
    review_command_id,
    reviewer_id,
    action,
    selected_category_id,
    reviewed_classification_id
  ) values (
    v_household,
    p_transaction_id,
    p_review_command_id,
    v_actor,
    'undo',
    p_category_id,
    v_confirmed
  );

  raise log 'transaction_category_undo %', jsonb_build_object(
    'transaction_id', p_transaction_id,
    'household_id', v_household,
    'review_command_id', p_review_command_id,
    'actor_id', v_actor,
    'previous_classification_id', v_confirmed,
    'new_classification_id', v_new_id
  );

  return jsonb_build_object(
    'conflict', false,
    'idempotent', false,
    'item', finance.transaction_feed_item(p_transaction_id)
  );
end;
$$;

create or replace function public.finance_set_transaction_treatment_v1(
  p_transaction_id text,
  p_is_transfer boolean,
  p_exclude_from_spend boolean,
  p_nature text,
  p_expected_confirmed_treatment_id uuid,
  p_expected_proposed_treatment_id uuid,
  p_review_command_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_actor uuid;
  v_confirmed uuid;
  v_proposed uuid;
  v_proposed_transfer boolean;
  v_proposed_exclude boolean;
  v_proposed_nature text;
  v_action text;
  v_nature text;
begin
  if nullif(btrim(p_review_command_id), '') is null then
    raise exception 'review command is required';
  end if;
  if p_is_transfer is null or p_exclude_from_spend is null then
    raise exception 'transfer and spend treatment are required';
  end if;
  v_nature := nullif(btrim(coalesce(p_nature, '')), '');
  if v_nature is not null and char_length(v_nature) > 80 then
    raise exception 'treatment nature is too long';
  end if;
  v_household := finance.resolve_caller_household();
  v_actor := finance.resolve_reviewer_id();

  perform 1
  from public.transactions
  where id = p_transaction_id
    and household_id = v_household
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  if exists (
    select 1 from finance.financial_event_legs
    where transaction_id = p_transaction_id
      and household_id = v_household
      and status = 'active'
  ) then
    raise exception 'event membership requires an explicit event review';
  end if;

  if exists (
    select 1 from finance.classification_feedback
    where household_id = v_household
      and review_command_id = p_review_command_id
  ) then
    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  select id into v_confirmed
  from finance.transaction_treatments
  where transaction_id = p_transaction_id
    and status = 'confirmed';
  select id, is_transfer, exclude_from_spend, nature
  into v_proposed, v_proposed_transfer, v_proposed_exclude, v_proposed_nature
  from finance.transaction_treatments
  where transaction_id = p_transaction_id
    and status = 'proposed'
  order by created_at desc
  limit 1;

  if v_confirmed is distinct from p_expected_confirmed_treatment_id
     or v_proposed is distinct from p_expected_proposed_treatment_id then
    return jsonb_build_object(
      'conflict', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  if v_proposed is null then
    v_action := 'manual';
  elsif v_proposed_transfer is not distinct from p_is_transfer
    and v_proposed_exclude is not distinct from p_exclude_from_spend
    and v_proposed_nature is not distinct from v_nature then
    v_action := 'approved';
  else
    v_action := 'corrected';
  end if;

  update finance.transaction_treatments
  set status = 'superseded', superseded_at = now()
  where transaction_id = p_transaction_id
    and household_id = v_household
    and status in ('confirmed', 'proposed');

  insert into finance.transaction_treatments (
    household_id,
    transaction_id,
    is_transfer,
    exclude_from_spend,
    nature,
    decision_source,
    status
  ) values (
    v_household,
    p_transaction_id,
    p_is_transfer,
    p_exclude_from_spend,
    v_nature,
    'user',
    'confirmed'
  );

  insert into finance.classification_feedback (
    household_id,
    transaction_id,
    review_command_id,
    reviewer_id,
    action,
    reviewed_treatment_id
  ) values (
    v_household,
    p_transaction_id,
    p_review_command_id,
    v_actor,
    v_action,
    v_proposed
  );

  raise log 'transaction_treatment_mutation %', jsonb_build_object(
    'transaction_id', p_transaction_id,
    'household_id', v_household,
    'review_command_id', p_review_command_id,
    'actor_id', v_actor,
    'previous_treatment_id', v_confirmed,
    'action', v_action
  );

  return jsonb_build_object(
    'conflict', false,
    'idempotent', false,
    'item', finance.transaction_feed_item(p_transaction_id)
  );
end;
$$;

create or replace function public.finance_record_classification_run(
  p_household_id uuid,
  p_transaction_id text,
  p_classifier_version text,
  p_model_id text,
  p_input_token_count integer,
  p_result jsonb,
  p_owned_category_id uuid,
  p_confidence numeric,
  p_is_transfer boolean,
  p_exclude_from_spend boolean,
  p_nature text
) returns uuid
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_run_id uuid;
  v_household uuid;
begin
  select household_id into v_household
  from public.transactions
  where id = p_transaction_id
  for update;
  if v_household is null or v_household <> p_household_id then
    raise exception 'transaction is not in this household';
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'confidence must be between 0 and 1';
  end if;
  if p_owned_category_id is not null and not exists (
    select 1 from finance.categories
    where id = p_owned_category_id and household_id = p_household_id
  ) then
    raise exception 'owned category is not in this household';
  end if;
  insert into finance.classification_runs (
    household_id,
    transaction_id,
    classifier,
    classifier_version,
    model_id,
    completed_at,
    status,
    input_token_count,
    result
  ) values (
    p_household_id,
    p_transaction_id,
    'jev',
    p_classifier_version,
    nullif(p_model_id, ''),
    now(),
    'succeeded',
    p_input_token_count,
    p_result
  )
  returning id into v_run_id;
  if p_owned_category_id is null then
    return v_run_id;
  end if;
  if p_is_transfer is null or p_exclude_from_spend is null or nullif(p_nature, '') is null then
    raise exception 'a proposal needs a treatment';
  end if;
  if not exists (
    select 1 from finance.transaction_classifications
    where transaction_id = p_transaction_id and status = 'confirmed'
  ) then
    update finance.transaction_classifications
    set status = 'superseded', superseded_at = now()
    where transaction_id = p_transaction_id
      and household_id = p_household_id
      and status = 'proposed';
    insert into finance.transaction_classifications (
      household_id,
      transaction_id,
      category_id,
      decision_source,
      status,
      confidence,
      run_id,
      reason
    ) values (
      p_household_id,
      p_transaction_id,
      p_owned_category_id,
      'jev',
      'proposed',
      p_confidence,
      v_run_id,
      'shadow proposal'
    );
  end if;
  if not exists (
    select 1 from finance.transaction_treatments
    where transaction_id = p_transaction_id and status = 'confirmed'
  ) then
    update finance.transaction_treatments
    set status = 'superseded', superseded_at = now()
    where transaction_id = p_transaction_id
      and household_id = p_household_id
      and status = 'proposed';
    insert into finance.transaction_treatments (
      household_id,
      transaction_id,
      is_transfer,
      exclude_from_spend,
      nature,
      decision_source,
      status
    ) values (
      p_household_id,
      p_transaction_id,
      p_is_transfer,
      p_exclude_from_spend,
      p_nature,
      'jev',
      'proposed'
    );
  end if;
  return v_run_id;
end;
$$;

revoke all on function finance.map_decision_provenance(text) from public, anon, authenticated;
revoke all on function finance.resolve_caller_household() from public, anon, authenticated;
revoke all on function finance.resolve_reviewer_id() from public, anon, authenticated;
revoke all on function finance.transaction_feed_item(text) from public, anon, authenticated;
revoke all on function finance.encode_transaction_cursor(timestamptz, text) from public, anon, authenticated;

revoke all on function public.finance_list_transactions_v1(text, integer, jsonb) from public, anon;
revoke all on function public.finance_get_transaction_v1(text) from public, anon;
revoke all on function public.finance_get_transaction_filters_v1() from public, anon;
revoke all on function public.finance_get_transaction_activity_v1() from public, anon;
revoke all on function public.finance_set_transaction_category_v1(text, uuid, uuid, uuid, text) from public, anon;
revoke all on function public.finance_undo_transaction_category_v1(text, uuid, uuid, text) from public, anon;
revoke all on function public.finance_set_transaction_treatment_v1(text, boolean, boolean, text, uuid, uuid, text) from public, anon;
revoke all on function public.finance_record_classification_run(uuid, text, text, text, integer, jsonb, uuid, numeric, boolean, boolean, text) from public, anon, authenticated;

grant execute on function public.finance_list_transactions_v1(text, integer, jsonb) to authenticated, service_role;
grant execute on function public.finance_get_transaction_v1(text) to authenticated, service_role;
grant execute on function public.finance_get_transaction_filters_v1() to authenticated, service_role;
grant execute on function public.finance_get_transaction_activity_v1() to authenticated, service_role;
grant execute on function public.finance_set_transaction_category_v1(text, uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.finance_undo_transaction_category_v1(text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.finance_set_transaction_treatment_v1(text, boolean, boolean, text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.finance_record_classification_run(uuid, text, text, text, integer, jsonb, uuid, numeric, boolean, boolean, text) to service_role;

revoke select on
  finance.sync_runs,
  finance.source_categories,
  finance.transaction_source_observations,
  finance.classification_runs,
  finance.classification_proposals,
  finance.classification_feedback,
  finance.account_semantics,
  finance.relationship_semantics,
  finance.transaction_classifications,
  finance.transaction_treatments,
  finance.financial_events,
  finance.financial_event_legs,
  finance.categories
from anon, authenticated;

alter table finance.sync_runs enable row level security;
alter table finance.source_categories enable row level security;
alter table finance.transaction_source_observations enable row level security;
alter table finance.classification_runs enable row level security;
alter table finance.classification_proposals enable row level security;
alter table finance.classification_feedback enable row level security;
alter table finance.account_semantics enable row level security;
alter table finance.relationship_semantics enable row level security;

notify pgrst, 'reload schema';
