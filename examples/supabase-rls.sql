-- Row-level security on every board table, with no policies: Supabase's Data API can no
-- longer read or write them, while their owner (the gateway's login) still can.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
