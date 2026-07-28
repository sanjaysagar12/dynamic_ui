-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — 05 · SEED THE FIRST OWNER
--  Creates a Supabase Auth user (email/password, pre-confirmed) and
--  links it to a public.users row with role = 'OWNER', so you have
--  someone who can log in and satisfy is_owner() from 03_rls.sql on
--  a brand-new project. Safe to re-run: matches on email and just
--  promotes/no-ops if the user already exists.
--  Requires 01_create_tables.sql, 02_guards.sql, 03_rls.sql to have
--  run first (needs pgcrypto, the "users" table, and "authUserId").
--
--  ⚠ EDIT v_email / v_password / v_name below before running, then
--  paste this whole file into the Supabase SQL Editor and run once.
--  This writes directly into Supabase's internal auth.users /
--  auth.identities tables — undocumented but a common seeding
--  technique; if a future Supabase Postgres version renames a column
--  here, prefer creating the user via the Admin API
--  (supabase.auth.admin.createUser) and then just re-run the
--  "link to public.users" step at the bottom of this file instead.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email    TEXT := 'sanjaysagar.main@gmail.com';
  v_password TEXT := '12345678';
  v_name     TEXT := 'Owner';
  v_auth_id  UUID;
BEGIN
  -- ── 1. Find or create the Supabase Auth user ────────────────────
  SELECT id INTO v_auth_id FROM auth.users WHERE email = v_email;

  IF v_auth_id IS NULL THEN
    v_auth_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      is_super_admin, is_sso_user, is_anonymous,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')),
      NOW(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', v_name),
      '', '', '', '',
      FALSE, FALSE, FALSE,
      NOW(), NOW()
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
      jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true),
      NOW(), NOW(), NOW()
    );

    RAISE NOTICE 'Created Supabase Auth user % (%) — password: %', v_auth_id, v_email, v_password;
  ELSE
    RAISE NOTICE 'Supabase Auth user already exists: % (%)', v_auth_id, v_email;
  END IF;

  -- ── 2. Link/promote the matching public.users profile to OWNER ──
  IF EXISTS (SELECT 1 FROM users WHERE "authUserId" = v_auth_id) THEN
    UPDATE users SET role = 'OWNER', "isActive" = TRUE, "updatedAt" = NOW()
    WHERE "authUserId" = v_auth_id;
  ELSIF EXISTS (SELECT 1 FROM users WHERE email = v_email) THEN
    UPDATE users SET role = 'OWNER', "isActive" = TRUE, "authUserId" = v_auth_id, "updatedAt" = NOW()
    WHERE email = v_email;
  ELSE
    INSERT INTO users (id, name, email, role, "isActive", "authUserId")
    VALUES (gen_random_uuid(), v_name, v_email, 'OWNER', TRUE, v_auth_id);
  END IF;

  RAISE NOTICE 'users row for % is now role OWNER', v_email;
END $$;
