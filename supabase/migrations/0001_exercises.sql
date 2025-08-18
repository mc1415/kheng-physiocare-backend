-- Create exercises table
create table if not exists public.exercises (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    instructions text,
    video_url text
);

alter table public.exercises enable row level security;

-- Allow all authenticated users to read exercises
create policy "Authenticated users can read exercises" on public.exercises
for select
to authenticated
using (true);

-- Only admins can modify exercises
create policy "Only admins can modify exercises" on public.exercises
for all
to authenticated
using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- Create assigned_exercises table
create table if not exists public.assigned_exercises (
    id uuid primary key default uuid_generate_v4(),
    patient_id uuid references patients(id),
    exercise_id uuid references exercises(id)
);

alter table public.assigned_exercises enable row level security;

-- Admins can manage assigned exercises
create policy "Admins manage assigned exercises" on public.assigned_exercises
for all
to authenticated
using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- Patients can read their own assigned exercises
create policy "Patients read own assignments" on public.assigned_exercises
for select
using (exists (
    select 1 from patients p
    where p.id = assigned_exercises.patient_id
      and p.auth_user_id = auth.uid()
));

-- Patients can insert assignments for themselves
create policy "Patients insert own assignments" on public.assigned_exercises
for insert
with check (exists (
    select 1 from patients p
    where p.id = assigned_exercises.patient_id
      and p.auth_user_id = auth.uid()
));
