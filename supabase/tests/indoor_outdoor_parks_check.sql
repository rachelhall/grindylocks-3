-- Rolled-back check for 20261103050100_indoor_outdoor_parks.sql (run after
-- 20261103050000_park_setting_enum is applied). Raises RESULTS [...] so
-- nothing is kept. Every row should have ok = true. 4 of 4 on Nov 2.
do $check$
declare out jsonb := '[]'::jsonb; n int; s text;
begin
  update public.parks set setting = 'indoor_outdoor' where slug = 'rocketown-nash' and setting = 'indoor';
  get diagnostics n = row_count;
  out := out || jsonb_build_object('check','one park updated','ok',n=1,'detail',n);
  select setting::text into s from public.parks where slug='rocketown-nash';
  out := out || jsonb_build_object('check','Rocketown is indoor_outdoor','ok',s='indoor_outdoor','detail',s);
  select count(*) into n from public.parks where setting='indoor_outdoor';
  out := out || jsonb_build_object('check','only Rocketown changed','ok',n=1,'detail',n);
  select count(*) into n from public.parks where setting='indoor';
  out := out || jsonb_build_object('check','four indoor parks left','ok',n=4,'detail',n);
  raise exception 'RESULTS %', out;
end $check$;
