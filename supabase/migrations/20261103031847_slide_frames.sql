-- v2, feed media framing (Nov 2): where each slide sits in its post's frame.
--
-- Feeds now crop media into one frame shape per post (set by the first
-- slide: 4:5 at the tallest, 1.91:1 at the widest, in between as it is),
-- instead of letterboxing. The poster drags each slide to frame it while
-- posting or in Edit post. The full, uncropped media is still one tap away
-- in the full-screen viewer, so nothing is lost.
--
-- frame_x and frame_y work like CSS object-position: 0 shows the left (or
-- top) edge of the media, 1 the right (or bottom) edge, 0.5 the middle.
-- Only the axis the media overflows on matters; the other is ignored.
-- Existing slides get 0.5, 0.5 (centred).
--
-- The author already updates their own slides ("author manages slides"),
-- and the media guard only stops changes to the media itself, so no new
-- function or policy is needed. Reframing doesn't stamp edited_at: it
-- changes how a post is shown, not what it says.
--
-- Additive: two new columns with defaults and checks.

alter table public.post_slides
  add column if not exists frame_x real not null default 0.5
    constraint post_slides_frame_x_range check (frame_x >= 0 and frame_x <= 1),
  add column if not exists frame_y real not null default 0.5
    constraint post_slides_frame_y_range check (frame_y >= 0 and frame_y <= 1);

comment on column public.post_slides.frame_x is
  'Where the slide sits in its post''s frame, left to right (0–1, like CSS object-position). 0.5 is centred.';
comment on column public.post_slides.frame_y is
  'Where the slide sits in its post''s frame, top to bottom (0–1, like CSS object-position). 0.5 is centred.';
