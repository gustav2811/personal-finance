-- Matched historical movements already own a FinWise identity. Carry that
-- identity into the publication guard instead of enqueueing another create.
do $migration$
declare
  v_definition text;
  v_anchor text := 'v_movement_id := v_candidate_ids[1];
            if v_message_class = ''statement'' then';
  v_replacement text := 'v_movement_id := v_candidate_ids[1];
            select finwise_transaction_id into v_existing_finwise_id
            from finance.bank_zero_movements
            where id = v_movement_id and household_id = v_route.household_id;
            if v_message_class = ''statement'' then';
begin
  v_definition := pg_get_functiondef(
    'public.bank_zero_record_observation_v1(text,text,text,text,text,timestamptz,jsonb,jsonb)'::regprocedure
  );
  if strpos(v_definition, v_replacement) > 0 then return; end if;
  if strpos(v_definition, v_anchor) = 0
     or (length(v_definition) - length(replace(v_definition, v_anchor, '')))
        <> length(v_anchor) then
    raise exception 'Expected exactly one matched-movement identity assignment';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;
