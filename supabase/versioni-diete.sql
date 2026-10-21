-- Squizzotti's Diet: diete con data di inizio, caricabili dall'app (pulsante "Carica nuova dieta").
-- Da incollare una volta in Supabase → SQL Editor → New query → Run. Si può rieseguire senza danni.
-- Non contiene dati personali: copia nella nuova tabella le diete già presenti.

-- Ogni riga è una dieta che vale dal lunedì "dal" in poi, finché non ne arriva una più recente.
create table if not exists public.diete_versioni (
  id bigint generated always as identity primary key,
  persona text not null check (persona in ('matteo', 'anna')),
  dal date not null check (extract(isodow from dal) = 1),
  dieta jsonb not null,
  fonte text,
  caricato timestamptz not null default now(),
  caricato_da uuid default auth.uid() references auth.users on delete set null,
  unique (persona, dal)
);
alter table public.diete_versioni enable row level security;
drop policy if exists "diete_versioni: membri" on public.diete_versioni;
create policy "diete_versioni: membri" on public.diete_versioni
  for all to authenticated
  using ((select public.is_membro()))
  with check ((select public.is_membro()));
revoke all on public.diete_versioni from anon;
grant select, insert, update, delete on public.diete_versioni to authenticated;

-- Le diete attuali diventano la prima versione (valida "da sempre": lunedì 3 gennaio 2000).
insert into public.diete_versioni (persona, dal, dieta, fonte, caricato)
select persona, date '2000-01-03', dieta, fonte, aggiornato from public.diete
on conflict (persona, dal) do nothing;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'diete_versioni') then
    alter publication supabase_realtime add table public.diete_versioni;
  end if;
end $$;

select persona, dal, fonte, caricato from public.diete_versioni order by persona, dal;
