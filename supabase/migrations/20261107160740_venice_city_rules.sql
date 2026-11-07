-- Venice follows the city rules (LAMC 63.44.N): Rec & Parks designated it a
-- skateboard-only park in Nov 2021 (board report 21-190), with city skatepark
-- hours and helmet, elbow and knee pads required. Rachel's call (Nov 7, 2026):
-- follow the law, and note that bladers ride there anyway.

update public.parks set helmet_required = true where slug = 'venice-la';

update public.park_sessions s
set days = '{1,2,3,4,5}'::smallint[],
  start_anchor = 'clock'::time_anchor, start_time = '12:00',
  end_anchor = 'sunset'::time_anchor, end_time = null,
  disciplines = '{skateboard}'::discipline[],
  note = 'City skatepark hours (LAMC 63.44.N): also 9:00 to sunset on holidays; closed when wet; helmet, elbow and knee pads required; skateboard only by city designation (2021), though bladers ride here (Rachel)'
from public.parks p
where s.park_id = p.id and p.slug = 'venice-la';

insert into public.park_sessions (park_id, days, start_anchor, start_time, end_anchor, end_time,
  disciplines, note)
select p.id, '{6,7}'::smallint[], 'clock'::time_anchor, '09:00', 'sunset'::time_anchor, null,
  '{skateboard}'::discipline[], null
from public.parks p
where p.slug = 'venice-la'
  and not exists (select 1 from public.park_sessions s where s.park_id = p.id and s.days = '{6,7}');
