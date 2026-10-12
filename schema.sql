-- TwoPoint private chat schema.
-- Create exactly two Auth users in Supabase Dashboard first.
-- Replace the email placeholders below with their exact email addresses.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.chat_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table private.chat_members enable row level security;
revoke all on private.chat_members from public, anon, authenticated;

insert into private.chat_members (user_id)
select id
from auth.users
where email in ('FIRST_ALLOWED_EMAIL@example.com', 'SECOND_ALLOWED_EMAIL@example.com')
on conflict (user_id) do nothing;

create or replace function private.is_chat_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.chat_members m
    where m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_chat_member() from public, anon;
grant execute on function private.is_chat_member() to authenticated;

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_expires_at_idx on public.messages (expires_at);

alter table public.messages enable row level security;

drop policy if exists "members can read unexpired messages" on public.messages;
create policy "members can read unexpired messages"
on public.messages for select to authenticated
using ((select private.is_chat_member()) and expires_at > now());

drop policy if exists "members can send their own messages" on public.messages;
create policy "members can send their own messages"
on public.messages for insert to authenticated
with check (
  (select private.is_chat_member())
  and sender_id = (select auth.uid())
  and char_length(body) between 1 and 2000
  and expires_at > now()
  and expires_at <= now() + interval '16 minutes'
);

drop policy if exists "members can clear messages" on public.messages;
create policy "members can clear messages"
on public.messages for delete to authenticated
using ((select private.is_chat_member()));

revoke all on public.messages from anon;
grant select, insert, delete on public.messages to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Expiry job is NOT active until you enable pg_cron and run a schedule.
-- In Supabase Dashboard > Database > Extensions, enable pg_cron if available.
-- Then run:
-- select cron.schedule(
--   'delete-expired-chat-messages',
--   '* * * * *',
--   $$delete from public.messages where expires_at <= now();$$
-- );
-- Verify with: select * from cron.job;
