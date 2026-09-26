-- Re-apply review semantics for databases that already ran the earlier
-- transaction-surface migrations. A user classification does not inherit the
-- JEV run. jev_proposed means JEV offered a category with nothing mapped to compare.

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
    'needs_review',
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
          or (
            v_review = 'needs_review'
            and case
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
            end in (
              'jev_disagrees',
              'jev_proposed',
              'unclassified',
              'classifier_abstained',
              'classifier_failed'
            )
          )
          or (
            v_review <> 'needs_review'
            and v_review = case
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

notify pgrst, 'reload schema';
