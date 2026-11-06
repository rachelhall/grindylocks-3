-- Organizers and "Who it's for": the new enum values. Kept in their own
-- migration and applied first, because Postgres can't use a new enum value in
-- the transaction that adds it. PRD: Grindylocks — Brand and Shop Accounts
-- PRD (Organizer pages).

-- organizer: a page for people who host things (Blading Camp, L.O.W. academy).
alter type public.page_role add value if not exists 'organizer';

-- inactive: an organizer's archive (the app says No longer active), next to
-- out_of_business (a brand's, Retired) and closed (a shop's).
alter type public.page_state add value if not exists 'inactive';
