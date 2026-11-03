/**
 * Roles and safety, app side (M5, Nov 2).
 *
 * Every rule lives in the database (migration `moderation`); the app only
 * calls its functions with the member's own session:
 * - Members report posts, comments and people (file_report) and wrong park
 *   info (report_park_info, with an optional photo of the sign in the
 *   private report-photos bucket). A repeat report is quietly accepted.
 * - A role holder whose post menu opens on a post with open reports they
 *   may act on (moderation_report_detail) can keep it hidden or dismiss the
 *   reports (moderate_reports). Warnings, suspensions and bans are on the
 *   web admin.
 * - A suspended or banned member sees why (my_restriction).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Database, Json } from './database.types';
import { deleteLocalFile, type PickedMedia, prepareForUpload } from './media';
import { uploadJpeg } from './park-photos';
import type { Profile } from './profiles';
import { fresh, keys, queryClient } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

type Enums = Database['public']['Enums'];
export type ReportReason = Enums['report_reason'];
export type ParkField = Enums['park_field'];

/* Reporting a post, comment or person ------------------------------------------------- */

/** What a report is about. `personId` and `username` are whose it is, for "Block them too?". */
export type ReportTarget =
  | { kind: 'post'; id: string; personId: string; username: string; parkName: string | null }
  | { kind: 'comment'; id: string; personId: string; username: string }
  | { kind: 'person'; id: string; personId: string; username: string };

/** Same limit as the database. */
export const MAX_REPORT_DETAILS = 500;

/**
 * The reasons a member can pick, in the mockup's order. "Not at this park"
 * is for posts only; `inappropriate` exists in the database but isn't offered.
 */
export function reportReasons(kind: ReportTarget['kind']): ReportReason[] {
  return kind === 'post'
    ? ['spam', 'harassment', 'wrong_park', 'involves_minor', 'other']
    : ['spam', 'harassment', 'involves_minor', 'other'];
}

/** Harassment, anything involving a minor and reports about a person go only to the owner. */
export const goesToOwner = (kind: ReportTarget['kind'], reason: ReportReason) =>
  kind === 'person' || reason === 'harassment' || reason === 'involves_minor';

export function useFileReport() {
  return useMutation({
    mutationFn: async ({ target, reason, details }: { target: ReportTarget; reason: ReportReason; details: string }) => {
      const { error } = await supabase.rpc('file_report', {
        post: target.kind === 'post' ? target.id : undefined,
        comment: target.kind === 'comment' ? target.id : undefined,
        person: target.kind === 'person' ? target.id : undefined,
        reason,
        details: details.trim() || undefined,
      });
      if (error) throw error;
    },
  });
}

/* Reporting park info ------------------------------------------------------------------ */

/** The refusals report_park_info can give that the sheet explains; anything else is generic. */
export type ParkReportError = 'say_what_is_wrong' | 'pick_an_obstacle' | 'photo_not_uploaded' | 'too_many_reports' | 'generic';

const PARK_REPORT_ERRORS = new Set(['say_what_is_wrong', 'pick_an_obstacle', 'photo_not_uploaded', 'too_many_reports']);

/** Same limit as the database. */
export const MAX_PARK_NOTE = 500;

/**
 * Sends a park info report. A photo is re-encoded like park photos, then
 * uploaded to report-photos at <park>/<me>/<id>.jpg before the report is
 * filed (the database checks the file is there). If the report is refused,
 * the photo is removed again.
 */
export function useReportParkInfo(parkId: string, userId: string | undefined) {
  return useMutation({
    mutationFn: async ({
      field,
      obstacle,
      suggested,
      note,
      photo,
    }: {
      field: ParkField;
      obstacle?: string;
      suggested?: Json;
      note: string;
      photo?: PickedMedia | null;
    }) => {
      if (!userId) throw new Error('generic');
      let photoPath: string | undefined;
      if (photo) {
        const id = uuid();
        photoPath = `${parkId}/${userId}/${id}.jpg`;
        const prepared = await prepareForUpload(photo, id);
        try {
          await uploadJpeg(prepared.uri, photoPath, 'report-photos');
        } finally {
          deleteLocalFile(prepared.uri);
        }
      }
      const { error } = await supabase.rpc('report_park_info', {
        park: parkId,
        field,
        obstacle,
        suggested,
        note: note.trim() || undefined,
        photo_path: photoPath,
      });
      if (error) {
        if (photoPath) await supabase.storage.from('report-photos').remove([photoPath]);
        throw new Error(PARK_REPORT_ERRORS.has(error.message) ? error.message : 'generic');
      }
    },
  });
}

/* A role holder's quick actions on a reported post -------------------------------------- */

/** The part of moderation_report_detail the post menu uses. */
export type ReportSummary = {
  count: number;
  /** The most common reason among the open reports. */
  reason: ReportReason;
  status: Enums['post_status'] | null;
};

type DetailJson = {
  post?: { status?: Enums['post_status'] } | null;
  reports?: { reason: ReportReason }[];
};

/**
 * Open reports on a post that the signed-in member may act on, or null when
 * there are none (or they hold no role). Fetched when a post's menu opens,
 * never per feed card. Members whose own profile is cached without a role
 * skip the call.
 */
export async function fetchReportSummary(userId: string, postId: string): Promise<ReportSummary | null> {
  const me = queryClient.getQueryData<Profile | null>(keys.myProfile(userId));
  if (me && me.roles.length === 0) return null;
  return queryClient.fetchQuery({
    queryKey: keys.reportDetail(userId, postId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('moderation_report_detail', { target_kind: 'post', target: postId });
      if (error) {
        if (error.code === 'P0002') return null;
        throw error;
      }
      const detail = data as DetailJson | null;
      const reports = detail?.reports ?? [];
      if (reports.length === 0) return null;
      const tally = new Map<ReportReason, number>();
      for (const r of reports) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
      const reason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { count: reports.length, reason, status: detail?.post?.status ?? null };
    },
    staleTime: fresh.mine,
  });
}

/**
 * Keep hidden (the author is told it was taken down) or dismiss the reports
 * (a hidden post comes back; nobody is told). Every cached copy of the post
 * is refetched.
 */
export function useModeratePost(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, decision }: { postId: string; decision: 'keep_hidden' | 'dismiss' }) => {
      const { error } = await supabase.rpc('moderate_reports', { target_kind: 'post', target: postId, decision });
      if (error) throw error;
    },
    onSettled: (_data, _error, { postId }) => {
      client.removeQueries({ queryKey: keys.reportDetail(userId ?? '', postId) });
      void client.invalidateQueries({ queryKey: keys.post(postId) });
      void client.invalidateQueries({ queryKey: ['feed'] });
      void client.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

/* Your own suspension or ban ------------------------------------------------------------- */

export type Restriction = { suspendedUntil: string | null; banned: boolean; message: string | null };

async function fetchRestriction(): Promise<Restriction | null> {
  const { data, error } = await supabase.rpc('my_restriction');
  if (error) throw error;
  const row = data?.[0];
  if (!row || (!row.banned && !row.suspended_until)) return null;
  return { suspendedUntil: row.suspended_until, banned: row.banned, message: row.message };
}

/** Null when you're neither suspended nor banned. Your own data, so checked on every view. */
export function useRestriction(userId: string | undefined) {
  return useQuery({
    queryKey: keys.restriction(userId ?? ''),
    queryFn: fetchRestriction,
    enabled: Boolean(userId),
    staleTime: fresh.mine,
  });
}

/**
 * When a write was refused by row-level security (code 42501), whether
 * that's because you're suspended or banned. Anything else returns null
 * without a call.
 */
export async function restrictionFor(userId: string | undefined, error: unknown): Promise<Restriction | null> {
  const code = (error as { code?: string } | null)?.code;
  if (!userId || code !== '42501') return null;
  return queryClient
    .fetchQuery({ queryKey: keys.restriction(userId), queryFn: fetchRestriction, staleTime: fresh.mine })
    .catch(() => null);
}
