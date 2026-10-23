-- 만드라고라: 사람들이 남긴 말 저장소
create extension if not exists pgcrypto;

create table if not exists public.mandrakes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 100),
  seed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mandrakes_created_at_idx on public.mandrakes (created_at desc);

-- 누구나 읽기만 가능. 쓰기는 서버 API(service role 키)를 통해서만.
alter table public.mandrakes enable row level security;
drop policy if exists "anyone can read" on public.mandrakes;
create policy "anyone can read" on public.mandrakes for select to anon, authenticated using (true);

-- 새 말이 들어오면 열려 있는 화면에 바로 반영되도록 실시간 구독 켜기
alter publication supabase_realtime add table public.mandrakes;
