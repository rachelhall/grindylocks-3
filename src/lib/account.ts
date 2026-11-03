/**
 * Your account's own data (M5): a copy of it by email, and deleting it.
 *
 * Both are Edge Functions called with the member's session:
 * - export-data emails everything Grindylocks keeps about you, once a day.
 * - delete-account needs a sign-in code entered in the last 15 minutes
 *   (the database checks the session), so Delete account first emails a
 *   code to your own address and has you enter it. Afterwards the app signs
 *   out locally, which clears the cache like any sign-out.
 */
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQuery } from '@tanstack/react-query';

import { forgetThisPhone } from './push';
import { fresh, keys } from './query';
import { supabase } from './supabase';

/** The error code an Edge Function replied with, or 'network' when it couldn't be reached. */
export async function functionErrorCode(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => ({}));
    return typeof body?.error === 'string' ? body.error : 'generic';
  }
  if (error instanceof FunctionsFetchError) return 'network';
  return 'generic';
}

/* A copy of my data ------------------------------------------------------------------- */

export type ExportError = 'export_once_a_day' | 'email_not_configured' | 'network' | 'generic';

export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('export-data', { method: 'POST' });
      if (!error) return;
      const code = await functionErrorCode(error);
      throw new Error(
        code === 'export_once_a_day' || code === 'email_not_configured' || code === 'network' ? code : 'generic',
      );
    },
  });
}

/* Deleting the account ------------------------------------------------------------------ */

/** How many posts and park photos you have, for the keep-or-delete choice. */
export function useMyContentCounts(userId: string | undefined) {
  return useQuery({
    queryKey: keys.myContentCounts(userId ?? ''),
    queryFn: async () => {
      const [posts, photos] = await Promise.all([
        supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', userId!)
          .not('published_at', 'is', null)
          .neq('status', 'deleted'),
        supabase
          .from('park_photos')
          .select('id', { count: 'exact', head: true })
          .eq('uploaded_by', userId!)
          .is('archived_at', null),
      ]);
      if (posts.error) throw posts.error;
      if (photos.error) throw photos.error;
      return { posts: posts.count ?? 0, photos: photos.count ?? 0 };
    },
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

export type DeleteError = 'confirm_with_a_code' | 'network' | 'generic';

/**
 * Deletes the account, then signs out on this phone only (the sign-in is
 * already gone on the server, so a global sign-out would just fail).
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async ({ keepPosts }: { keepPosts: boolean }) => {
      const { error } = await supabase.functions.invoke('delete-account', { body: { keep_posts: keepPosts } });
      if (error) {
        const code = await functionErrorCode(error);
        throw new Error(code === 'confirm_with_a_code' || code === 'network' ? code : 'generic');
      }
      // Stop pushes to this phone while the session still works, then sign out.
      await forgetThisPhone().catch(() => undefined);
      await supabase.auth.signOut({ scope: 'local' });
    },
  });
}
