/*
 * Supabase tables and RLS policies for Summit
 *
 * All data tables use the schema: { user_id uuid PK, data jsonb, updated_at timestamptz }
 * All policies follow the same pattern: auth.uid() = user_id
 *
 * ─── profiles ───────────────────────────────────────────────────────────────
 * Columns: id uuid PK (references auth.users), username text
 * Used by: upsertProfile(), getProfile(), getAllUsers()
 *
 *   create table if not exists profiles (
 *     id uuid references auth.users(id) on delete cascade primary key,
 *     username text
 *   );
 *   alter table profiles enable row level security;
 *   create policy "select own" on profiles for select using (auth.uid() = id);
 *   create policy "insert own" on profiles for insert with check (auth.uid() = id);
 *   create policy "update own" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
 *
 * ─── daily_logs ─────────────────────────────────────────────────────────────
 * Columns: user_id uuid PK, data jsonb, updated_at timestamptz
 * Used by: dbGet/dbSet('daily_logs', ...)
 *
 *   create table if not exists daily_logs (
 *     user_id uuid references auth.users(id) on delete cascade primary key,
 *     data jsonb, updated_at timestamptz default now()
 *   );
 *   alter table daily_logs enable row level security;
 *   create policy "select own" on daily_logs for select using (auth.uid() = user_id);
 *   create policy "insert own" on daily_logs for insert with check (auth.uid() = user_id);
 *   create policy "update own" on daily_logs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * ─── climb_logs ─────────────────────────────────────────────────────────────
 * Same schema and policies as daily_logs. Used by: dbGet/dbSet('climb_logs', ...)
 *
 * ─── assessments ────────────────────────────────────────────────────────────
 * Same schema and policies as daily_logs. Used by: dbGet/dbSet('assessments', ...)
 *
 * ─── injury_logs ────────────────────────────────────────────────────────────
 * Same schema and policies as daily_logs. Used by: dbGet/dbSet('injury_logs', ...)
 *
 * ─── settings ───────────────────────────────────────────────────────────────
 * Same schema and policies as daily_logs. Used by: dbGet/dbSet('settings', ...)
 *
 * ─── athlete_data ────────────────────────────────────────────────────────────
 * Same schema and policies as daily_logs. Used by: dbGet/dbSet('athlete_data', ...)
 * Stores athlete profile: bodyweight, height, sex, age, dominantHand,
 * climbingYears, trainingYears, discipline[], onsightGradeSport,
 * onsightGradeBoulder, completed.
 *
 *   create table if not exists athlete_data (
 *     user_id uuid references auth.users(id) on delete cascade primary key,
 *     data jsonb, updated_at timestamptz default now()
 *   );
 *   alter table athlete_data enable row level security;
 *   create policy "select own" on athlete_data for select using (auth.uid() = user_id);
 *   create policy "insert own" on athlete_data for insert with check (auth.uid() = user_id);
 *   create policy "update own" on athlete_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * ─── Template for new tables ────────────────────────────────────────────────
 *   create table if not exists <table_name> (
 *     user_id uuid references auth.users(id) on delete cascade primary key,
 *     data jsonb, updated_at timestamptz default now()
 *   );
 *   alter table <table_name> enable row level security;
 *   create policy "select own" on <table_name> for select using (auth.uid() = user_id);
 *   create policy "insert own" on <table_name> for insert with check (auth.uid() = user_id);
 *   create policy "update own" on <table_name> for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
