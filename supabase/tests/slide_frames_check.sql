-- Rolled-back check for 20261103031847_slide_frames.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
do $check$
declare
  out jsonb := '[]'::jsonb;
  s record;
  other uuid;
  n int;
  err text;
begin
  alter table public.post_slides
    add column if not exists frame_x real not null default 0.5
      constraint post_slides_frame_x_range check (frame_x >= 0 and frame_x <= 1),
    add column if not exists frame_y real not null default 0.5
      constraint post_slides_frame_y_range check (frame_y >= 0 and frame_y <= 1);

  -- Existing slides are centred.
  select count(*) into n from public.post_slides where frame_x <> 0.5 or frame_y <> 0.5;
  out := out || jsonb_build_object('check', 'existing slides start centred', 'ok', n = 0, 'detail', n);

  -- Out of range is refused.
  begin
    update public.post_slides set frame_y = 1.5 where id = (select id from public.post_slides limit 1);
    err := 'accepted';
  exception when check_violation then
    err := 'refused';
  end;
  out := out || jsonb_build_object('check', 'frame_y 1.5 is refused', 'ok', err = 'refused', 'detail', err);

  -- A published slide and its author.
  select ps.id, ps.post_id, p.author_id, p.edited_at, p.published_at into s
    from public.post_slides ps join public.posts p on p.id = ps.post_id
   where p.published_at is not null and p.author_id is not null
   limit 1;
  select id into other from public.profiles where id <> s.author_id limit 1;

  -- The author can reframe their own slide, and it doesn't stamp edited_at.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s.author_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.post_slides set frame_x = 0.25, frame_y = 0.1 where id = s.id;
  get diagnostics n = row_count;
  reset role;
  out := out || jsonb_build_object('check', 'author can reframe their slide', 'ok', n = 1, 'detail', n);
  out := out || jsonb_build_object('check', 'reframing leaves edited_at alone',
    'ok', (select edited_at is not distinct from s.edited_at from public.posts where id = s.post_id), 'detail', '');

  -- Someone else can't.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.post_slides set frame_x = 0.9 where id = s.id;
  get diagnostics n = row_count;
  reset role;
  out := out || jsonb_build_object('check', 'another member can''t reframe it', 'ok', n = 0, 'detail', n);
  out := out || jsonb_build_object('check', 'frame kept the author''s values',
    'ok', (select frame_x = 0.25::real and frame_y = 0.1::real from public.post_slides where id = s.id), 'detail', '');

  -- The media guard still blocks media changes.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s.author_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.post_slides set width = width + 1 where id = s.id;
    err := 'accepted';
  exception when others then
    err := 'refused';
  end;
  reset role;
  out := out || jsonb_build_object('check', 'media guard still blocks a size change', 'ok', err = 'refused', 'detail', err);

  raise exception 'RESULTS %', out;
end
$check$;
