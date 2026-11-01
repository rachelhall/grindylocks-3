/** People search for the Search tab. */
import type { Database } from './database.types';
import { supabase } from './supabase';

export type PersonResult = Database['public']['Functions']['search_people']['Returns'][number];

/**
 * Members by username, prefix matches first. The server leaves out anyone
 * blocked either way, banned members, deleted accounts and people who
 * haven't finished onboarding (migration `search_people`).
 */
export async function searchPeople(q: string): Promise<PersonResult[]> {
  const { data, error } = await supabase.rpc('search_people', { q, max_results: 20 });
  if (error) throw error;
  return data ?? [];
}
