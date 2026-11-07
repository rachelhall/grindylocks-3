-- v2, map filters (Nov 2): a park setting for parks with both indoor and
-- outdoor sections, like Woodward and Rocketown. The map's Setting filter
-- shows these parks for either Indoor or Outdoor.
--
-- On its own because a new enum value can't be used in the same transaction
-- that adds it; 20261103050100_indoor_outdoor_parks uses it.

alter type public.park_setting add value if not exists 'indoor_outdoor' after 'outdoor';
