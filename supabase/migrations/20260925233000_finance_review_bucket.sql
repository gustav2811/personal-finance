-- Review is the human queue: disagreement, no category, abstention, failure.
-- Agreement stays quiet. Awaiting a classifier run is a backlog, not a decision.

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
    'confirmed', 'jev_agrees', 'jev_disagrees', 'unclassified',
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
              when proposed.id is not null then 'jev_disagrees'
              when latest_run.status = 'failed' then 'classifier_failed'
              when latest_run.status = 'succeeded' and proposed.id is null then 'classifier_abstained'
              when mapped.owned_category_id is null and t.source_category_name_snapshot is null then 'unclassified'
              when latest_run.status is null then 'awaiting_classifier'
              else 'unclassified'
            end in (
              'jev_disagrees',
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
              when proposed.id is not null then 'jev_disagrees'
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


grant execute on function public.finance_list_transactions_v1(text, integer, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
