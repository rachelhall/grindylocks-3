/**
 * Obstacle type names in English, copied from the app's
 * `src/i18n/locales/en.json` (`obstacleTypes`). The public pages are English
 * only for now. `npm run check:shared` fails if this copy goes stale.
 */
import type { Database } from "./database.types";

export const OBSTACLE_TYPES: Record<Database["public"]["Enums"]["obstacle_type"], string> = {
  rail: "Rail",
  ledge: "Ledge",
  hubba: "Hubba",
  manual_pad: "Manual pad",
  stairs: "Stairs",
  gap: "Gap",
  bank: "Bank",
  pyramid: "Pyramid",
  fun_box: "Fun box",
  box: "Box",
  hip: "Hip",
  quarter_pipe: "Quarter pipe",
  kicker: "Kicker",
  mini_ramp: "Mini ramp",
  half_pipe: "Half pipe",
  vert_ramp: "Vert ramp",
  spine: "Spine",
  bump: "Bump",
  volcano: "Volcano",
  bowl: "Bowl",
  pool: "Pool",
  snake_run: "Snake run",
  ditch: "Ditch",
  full_pipe: "Full pipe",
  pump_track: "Pump track",
  pole_jam: "Pole jam",
  rainbow_bench: "Rainbow bench",
  other: "Other",
  street_plaza: "Street plaza",
};
