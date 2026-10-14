-- Keep the source-managed baselines untouched while allowing household edits.
-- The expected values make the edit safe when two dashboard tabs are open.
create or replace function public.finance_update_transaction_details_v1(
  p_transaction_id text,
  p_description text,
  p_notes text,
  p_expected_description text,
  p_expected_notes text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_description text;
  v_notes text;
begin
  if p_description is null or btrim(p_description) = '' then
    raise exception 'description is required';
  end if;
  p_description := btrim(p_description);
  v_household := finance.resolve_caller_household();
  perform finance.resolve_reviewer_id();

  select description, notes
    into v_description, v_notes
  from public.transactions
  where id = p_transaction_id
    and household_id = v_household
  for update;

  if not found then
    raise exception 'transaction not found';
  end if;

  if v_description is distinct from p_expected_description
     or v_notes is distinct from p_expected_notes then
    return jsonb_build_object(
      'conflict', true,
      'idempotent', false,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  if v_description is not distinct from p_description
     and v_notes is not distinct from p_notes then
    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'item', finance.transaction_feed_item(p_transaction_id)
    );
  end if;

  update public.transactions
  set description = p_description,
      notes = p_notes,
      updated_at = now()
  where id = p_transaction_id
    and household_id = v_household;

  return jsonb_build_object(
    'conflict', false,
    'idempotent', false,
    'item', finance.transaction_feed_item(p_transaction_id)
  );
end;
$$;

-- Add household notes to the existing feed contract without duplicating its
-- classification/review logic.
alter function finance.transaction_feed_item(text)
  rename to transaction_feed_item_without_notes;

create or replace function finance.transaction_feed_item(p_transaction_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, finance, pg_temp
as $$
  select jsonb_set(
    finance.transaction_feed_item_without_notes(p_transaction_id),
    '{notes}',
    coalesce(to_jsonb(tx.notes), 'null'::jsonb),
    true
  )
  from public.transactions tx
  where tx.id = p_transaction_id;
$$;

revoke all on function public.finance_update_transaction_details_v1(text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.finance_update_transaction_details_v1(text, text, text, text, text)
  to authenticated, service_role;

revoke all on function finance.transaction_feed_item(text)
  from public, anon, authenticated;
grant execute on function finance.transaction_feed_item(text)
  to service_role;

revoke all on function public.finance_list_transactions_v1(text, integer, jsonb)
  from public, anon;
grant execute on function public.finance_list_transactions_v1(text, integer, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- Save the editable parts of the review panel as one command. Each underlying
-- command runs in a nested block so a later optimistic conflict rolls back an
-- earlier description/notes or category write.
create or replace function public.finance_review_transaction_v1(
  p_transaction_id text,
  p_category_id uuid,
  p_description text,
  p_notes text,
  p_is_transfer boolean,
  p_exclude_from_spend boolean,
  p_nature text,
  p_expected jsonb,
  p_review_command_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household uuid;
  v_expected_description text;
  v_expected_notes text;
  v_expected_confirmed_classification uuid;
  v_expected_proposed_classification uuid;
  v_expected_confirmed_treatment uuid;
  v_expected_proposed_treatment uuid;
  v_description text;
  v_notes text;
  v_confirmed_classification uuid;
  v_proposed_classification uuid;
  v_confirmed_category uuid;
  v_proposed_category uuid;
  v_confirmed_treatment uuid;
  v_proposed_treatment uuid;
  v_confirmed_transfer boolean;
  v_confirmed_exclude boolean;
  v_confirmed_nature text;
  v_event boolean;
  v_details_changed boolean;
  v_category_changed boolean := false;
  v_treatment_changed boolean := false;
  v_result jsonb;
begin
  if nullif(btrim(p_review_command_id), '') is null then
    raise exception 'review command is required';
  end if;
  if p_expected is null or jsonb_typeof(p_expected) <> 'object' then
    raise exception 'expected review state is required';
  end if;

  v_household := finance.resolve_caller_household();
  perform finance.resolve_reviewer_id();

  select t.description, t.notes
    into v_description, v_notes
  from public.transactions t
  where t.id = p_transaction_id
    and t.household_id = v_household
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  select id, category_id into v_confirmed_classification, v_confirmed_category
  from finance.transaction_classifications
  where transaction_id = p_transaction_id and status = 'confirmed';
  select id, category_id into v_proposed_classification, v_proposed_category
  from finance.transaction_classifications
  where transaction_id = p_transaction_id and status = 'proposed'
  order by created_at desc limit 1;
  select id, is_transfer, exclude_from_spend, nature
    into v_confirmed_treatment, v_confirmed_transfer, v_confirmed_exclude, v_confirmed_nature
  from finance.transaction_treatments
  where transaction_id = p_transaction_id and status = 'confirmed';
  select id into v_proposed_treatment
  from finance.transaction_treatments
  where transaction_id = p_transaction_id and status = 'proposed'
  order by created_at desc limit 1;
  select exists (
    select 1 from finance.financial_event_legs
    where transaction_id = p_transaction_id and household_id = v_household and status = 'active'
  ) into v_event;

  v_expected_description := p_expected->>'description';
  v_expected_notes := p_expected->>'notes';
  v_expected_confirmed_classification := nullif(p_expected->>'confirmedClassificationId', '')::uuid;
  v_expected_proposed_classification := nullif(p_expected->>'proposedClassificationId', '')::uuid;
  v_expected_confirmed_treatment := nullif(p_expected->>'confirmedTreatmentId', '')::uuid;
  v_expected_proposed_treatment := nullif(p_expected->>'proposedTreatmentId', '')::uuid;

  -- A response-loss retry sees the already-applied desired values. Resolve it
  -- before comparing the old expected snapshot, while changed fields still
  -- receive the full optimistic metadata check below.
  v_details_changed := v_description is distinct from p_description
    or v_notes is distinct from p_notes;
  if p_category_id is not null then
    v_category_changed := v_confirmed_classification is null
      or v_confirmed_category is distinct from p_category_id;
  end if;
  if p_is_transfer is not null and p_exclude_from_spend is not null then
    v_treatment_changed := v_confirmed_treatment is null
      or v_confirmed_transfer is distinct from p_is_transfer
      or v_confirmed_exclude is distinct from p_exclude_from_spend
      or v_confirmed_nature is distinct from nullif(btrim(coalesce(p_nature, '')), '');
  end if;
  if not v_details_changed and not v_category_changed and not v_treatment_changed then
    return jsonb_build_object('conflict', false, 'idempotent', true, 'item', finance.transaction_feed_item(p_transaction_id));
  end if;

  -- Validate the complete panel snapshot, including fields that the caller did
  -- not change, before doing any writes.
  if v_description is distinct from v_expected_description
     or v_notes is distinct from v_expected_notes
     or v_confirmed_classification is distinct from v_expected_confirmed_classification
     or v_proposed_classification is distinct from v_expected_proposed_classification
     or v_confirmed_treatment is distinct from v_expected_confirmed_treatment
     or v_proposed_treatment is distinct from v_expected_proposed_treatment then
    return jsonb_build_object('conflict', true, 'idempotent', false, 'item', finance.transaction_feed_item(p_transaction_id));
  end if;

  if p_is_transfer is not null and p_exclude_from_spend is not null then
    if v_treatment_changed and v_event then
      return jsonb_build_object('conflict', true, 'idempotent', false, 'item', finance.transaction_feed_item(p_transaction_id));
    end if;
  end if;

  begin
    if v_details_changed then
      v_result := public.finance_update_transaction_details_v1(
        p_transaction_id, p_description, p_notes, v_description, v_notes
      );
    end if;

    if v_category_changed then
      v_result := public.finance_set_transaction_category_v1(
        p_transaction_id,
        p_category_id,
        v_expected_confirmed_classification,
        v_expected_proposed_classification,
        p_review_command_id || ':category'
      );
      if coalesce((v_result->>'conflict')::boolean, false) then
        raise exception 'review_conflict';
      end if;
    end if;

    if v_treatment_changed then
      v_result := public.finance_set_transaction_treatment_v1(
        p_transaction_id,
        p_is_transfer,
        p_exclude_from_spend,
        p_nature,
        v_expected_confirmed_treatment,
        v_expected_proposed_treatment,
        p_review_command_id || ':treatment'
      );
      if coalesce((v_result->>'conflict')::boolean, false) then
        raise exception 'review_conflict';
      end if;
    end if;
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm = 'review_conflict' then
        return jsonb_build_object('conflict', true, 'idempotent', false, 'item', finance.transaction_feed_item(p_transaction_id));
      end if;
      raise;
  end;

  return jsonb_build_object('conflict', false, 'idempotent', false, 'item', finance.transaction_feed_item(p_transaction_id));
end;
$$;

revoke all on function public.finance_review_transaction_v1(text, uuid, text, text, boolean, boolean, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.finance_review_transaction_v1(text, uuid, text, text, boolean, boolean, text, jsonb, text)
  to authenticated;

notify pgrst, 'reload schema';

-- Apply review status together with all other filters before pagination.
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
    'needs_review', 'not_reviewed',
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
          or (v_review = 'not_reviewed' and confirmed.id is null)
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

revoke all on function public.finance_list_transactions_v1(text, integer, jsonb) from public, anon;
grant execute on function public.finance_list_transactions_v1(text, integer, jsonb) to authenticated, service_role;
revoke all on function finance.transaction_feed_item(text) from public, anon, authenticated;
grant execute on function finance.transaction_feed_item(text) to service_role;
revoke all on function finance.transaction_feed_item_without_notes(text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
