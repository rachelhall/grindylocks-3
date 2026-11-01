/** "Say hi" announcements: telling skaters in a city that someone new arrived. */
import { Sentry } from './sentry';
import { supabase } from './supabase';

/**
 * Announces the member to their (new) home city. Used when onboarding
 * finishes and after moving cities in Edit profile, and only when the member
 * left the toggle on. A failure is logged, never shown: it isn't worth
 * blocking anyone over.
 */
export async function announceArrival(userId: string, metroAreaId: string, parkId: string | null) {
  const { error } = await supabase.from('announcements').insert({
    user_id: userId,
    kind: 'joined',
    metro_area_id: metroAreaId,
    park_id: parkId,
  });
  if (error) Sentry.captureException(error);
}
