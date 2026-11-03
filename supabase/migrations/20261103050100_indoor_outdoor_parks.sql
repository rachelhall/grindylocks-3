-- v2, map filters (Nov 2): seeded parks that have both indoor and outdoor
-- sections move to the new 'indoor_outdoor' setting.
--
-- Rocketown (Nashville) has both (Rachel, Nov 2). Others get fixed through
-- park info reports as people spot them.

update public.parks
   set setting = 'indoor_outdoor'
 where slug = 'rocketown-nash'
   and setting = 'indoor';
