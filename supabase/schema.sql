-- Squizzotti's Diet: schema del database Supabase.
-- Da incollare una volta in Supabase → SQL Editor → New query → Run.
-- Non contiene dati personali: le diete e i membri si caricano a parte.

-- ---------- Chi può usare l'app ----------
-- Solo gli utenti elencati qui vedono e modificano i dati (Matteo e Anna).
create table if not exists public.membri (
  user_id uuid primary key references auth.users on delete cascade,
  persona text not null check (persona in ('matteo', 'anna'))
);
alter table public.membri enable row level security;
drop policy if exists "membri: vedo me stesso" on public.membri;
create policy "membri: vedo me stesso" on public.membri
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_membro() from public, anon;
grant execute on function public.is_membro() to authenticated;

-- ---------- Diete (una per persona) ----------
-- Scritte solo da Claude Code tramite SQL Editor: l'app le legge e basta.
create table if not exists public.diete (
  persona text primary key check (persona in ('matteo', 'anna')),
  dieta jsonb not null,
  aggiornato timestamptz not null default now(),
  fonte text
);
create table if not exists public.diete_archivio (
  id bigint generated always as identity primary key,
  persona text not null,
  dieta jsonb not null,
  fonte text,
  archiviato timestamptz not null default now()
);
alter table public.diete enable row level security;
alter table public.diete_archivio enable row level security;
drop policy if exists "diete: lettura membri" on public.diete;
create policy "diete: lettura membri" on public.diete
  for select to authenticated using ((select public.is_membro()));

-- ---------- Settimane (piano + spesa) ----------
-- dati = {"piano": {matteo|anna: {d0..d6: {<pasto>: {v, s}}}}, "spesa": {<prodotto>|x-<id>: true},
--         "extra": {<id>: {"n": "voce scritta a mano", "t": timestamp}}}
create table if not exists public.settimane (
  settimana date primary key check (extract(isodow from settimana) = 1),
  dati jsonb not null default '{"piano": {}, "spesa": {}}',
  aggiornato timestamptz not null default now()
);
alter table public.settimane enable row level security;
drop policy if exists "settimane: membri" on public.settimane;
create policy "settimane: membri" on public.settimane
  for all to authenticated
  using ((select public.is_membro()))
  with check ((select public.is_membro()));

-- Unione "merge patch" (RFC 7396): gli oggetti si fondono, null cancella, il resto sostituisce.
create or replace function public.jsonb_merge_patch(target jsonb, patch jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; r jsonb;
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then return patch; end if;
  r := case when jsonb_typeof(target) = 'object' then target else '{}'::jsonb end;
  for k, v in select * from jsonb_each(patch) loop
    if jsonb_typeof(v) = 'null' then r := r - k;
    elsif jsonb_typeof(v) = 'object' then r := jsonb_set(r, array[k], public.jsonb_merge_patch(r -> k, v));
    else r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end $$;

-- L'app salva solo le modifiche: due telefoni che scrivono insieme non si cancellano a vicenda.
create or replace function public.aggiorna_settimana(p_settimana date, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r jsonb;
begin
  insert into public.settimane as s (settimana, dati)
  values (p_settimana, public.jsonb_merge_patch('{"piano": {}, "spesa": {}}'::jsonb, p_patch))
  on conflict (settimana) do update
    set dati = public.jsonb_merge_patch(s.dati, p_patch), aggiornato = now()
  returning dati into r;
  return r;
end $$;

-- ---------- Permessi ----------
revoke all on public.membri, public.diete, public.diete_archivio, public.settimane from anon;
grant select on public.membri, public.diete to authenticated;
grant select, insert, update, delete on public.settimane to authenticated;
revoke execute on function public.aggiorna_settimana(date, jsonb) from public, anon;
grant execute on function public.aggiorna_settimana(date, jsonb) to authenticated;

-- ---------- Aggiornamenti in tempo reale ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settimane') then
    alter publication supabase_realtime add table public.settimane;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'diete') then
    alter publication supabase_realtime add table public.diete;
  end if;
end $$;

-- ---------- Diete con data di inizio ----------
-- Dopo questo file eseguire anche supabase/versioni-diete.sql (tabella diete_versioni, usata dal pulsante "Carica nuova dieta").
