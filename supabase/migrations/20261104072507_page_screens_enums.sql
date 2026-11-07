-- Brand and shop accounts, part A, PR 2 (page screens): the new report reasons.
-- On their own because Postgres can't use a new enum value in the transaction
-- that adds it; 20261104010100_page_screens uses them.
--
-- impersonation  "Pretending to be a brand or shop": on page reports, and on
--                profile reports (with the page it imitates).
-- our_page       "This is our brand or shop": a disputed page (page reports only).
-- wrong_info     "Wrong info": name, location, hours or links (page reports only).

alter type public.report_reason add value if not exists 'impersonation';
alter type public.report_reason add value if not exists 'our_page';
alter type public.report_reason add value if not exists 'wrong_info';
