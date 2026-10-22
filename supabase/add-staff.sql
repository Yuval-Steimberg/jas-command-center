-- Grant command-center access to an EXISTING Supabase Auth user of the command
-- center project (Authentication → Users → Add user, Auto Confirm).
-- One DO block = one statement, so it applies fully or not at all.
do $$
declare
  v_email text := 'owner@example.com';   -- ← edit
  v_name  text := 'Full Name';           -- ← edit
  v_role  text := 'owner';               -- owner | admin | operations_manager | project_manager | viewer
  v_auth  uuid;
  v_prof  uuid;
begin
  select id into v_auth from auth.users where lower(email) = lower(v_email);
  if v_auth is null then
    raise exception 'No auth user with email %; create it first', v_email;
  end if;
  insert into cc_profiles (auth_user_id, email, full_name, is_active)
  values (v_auth, lower(v_email), v_name, true)
  on conflict (email) do update set auth_user_id = excluded.auth_user_id, full_name = excluded.full_name, is_active = true, updated_at = now()
  returning id into v_prof;
  delete from cc_user_roles where profile_id = v_prof;
  insert into cc_user_roles (profile_id, role) values (v_prof, v_role);
  raise notice 'Granted % to %', v_role, v_email;
end $$;
