create or replace function public.finance_caller_membership_v1()
returns jsonb
language sql
stable
security definer
set search_path = public, finance, pg_temp
as $$
  select jsonb_build_object(
    'member',
    exists (
      select 1
      from finance.household_members as member
      where member.auth_user_id = auth.uid()
         or lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
$$;

revoke all on function public.finance_caller_membership_v1() from public, anon;
grant execute on function public.finance_caller_membership_v1() to authenticated;
