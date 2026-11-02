export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["announcement_kind"]
          metro_area_id: string
          park_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["announcement_kind"]
          metro_area_id: string
          park_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["announcement_kind"]
          metro_area_id?: string
          park_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          reply_to_user_id: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          reply_to_user_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          reply_to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_reply_to_user_id_fkey"
            columns: ["reply_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          status: Database["public"]["Enums"]["follow_status"]
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          status?: Database["public"]["Enums"]["follow_status"]
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          status?: Database["public"]["Enums"]["follow_status"]
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          cancelled_at: string | null
          code: string
          created_at: string
          expires_at: string
          id: string
          inviter_id: string
          returned_at: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          cancelled_at?: string | null
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          inviter_id: string
          returned_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          cancelled_at?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          inviter_id?: string
          returned_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metro_areas: {
        Row: {
          country: string
          created_at: string
          id: string
          name: string
          region: string | null
          timezone: string | null
        }
        Insert: {
          country: string
          created_at?: string
          id?: string
          name: string
          region?: string | null
          timezone?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          name?: string
          region?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          comment_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          park_id: string | null
          post_id: string | null
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          park_id?: string | null
          post_id?: string | null
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          park_id?: string | null
          post_id?: string | null
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      obstacles: {
        Row: {
          approved_by: string | null
          archived_at: string | null
          created_at: string
          depth_cm: number | null
          general_type: Database["public"]["Enums"]["obstacle_type"]
          height_cm: number | null
          id: string
          merged_into: string | null
          name: string
          notes: string | null
          park_id: string
          status: Database["public"]["Enums"]["obstacle_status"]
          suggested_by: string | null
        }
        Insert: {
          approved_by?: string | null
          archived_at?: string | null
          created_at?: string
          depth_cm?: number | null
          general_type: Database["public"]["Enums"]["obstacle_type"]
          height_cm?: number | null
          id?: string
          merged_into?: string | null
          name: string
          notes?: string | null
          park_id: string
          status?: Database["public"]["Enums"]["obstacle_status"]
          suggested_by?: string | null
        }
        Update: {
          approved_by?: string | null
          archived_at?: string | null
          created_at?: string
          depth_cm?: number | null
          general_type?: Database["public"]["Enums"]["obstacle_type"]
          height_cm?: number | null
          id?: string
          merged_into?: string | null
          name?: string
          notes?: string | null
          park_id?: string
          status?: Database["public"]["Enums"]["obstacle_status"]
          suggested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obstacles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obstacles_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "obstacles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obstacles_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obstacles_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      park_admin_notes: {
        Row: {
          notes: string | null
          park_id: string
          sources: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          notes?: string | null
          park_id: string
          sources?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          notes?: string | null
          park_id?: string
          sources?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "park_admin_notes_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: true
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_admin_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      park_descriptions: {
        Row: {
          author_id: string | null
          body: string
          locale: string
          park_id: string
          source: Database["public"]["Enums"]["text_source"]
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          locale: string
          park_id: string
          source?: Database["public"]["Enums"]["text_source"]
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          locale?: string
          park_id?: string
          source?: Database["public"]["Enums"]["text_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "park_descriptions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_descriptions_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      park_edits: {
        Row: {
          created_at: string
          editor_id: string | null
          field: string
          id: string
          info_report_id: string | null
          new_value: Json | null
          obstacle_id: string | null
          old_value: Json | null
          park_id: string
          reverts_edit_id: string | null
        }
        Insert: {
          created_at?: string
          editor_id?: string | null
          field: string
          id?: string
          info_report_id?: string | null
          new_value?: Json | null
          obstacle_id?: string | null
          old_value?: Json | null
          park_id: string
          reverts_edit_id?: string | null
        }
        Update: {
          created_at?: string
          editor_id?: string | null
          field?: string
          id?: string
          info_report_id?: string | null
          new_value?: Json | null
          obstacle_id?: string | null
          old_value?: Json | null
          park_id?: string
          reverts_edit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "park_edits_editor_id_fkey"
            columns: ["editor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_edits_info_report_id_fkey"
            columns: ["info_report_id"]
            isOneToOne: false
            referencedRelation: "park_info_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_edits_obstacle_id_fkey"
            columns: ["obstacle_id"]
            isOneToOne: false
            referencedRelation: "obstacles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_edits_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_edits_reverts_edit_id_fkey"
            columns: ["reverts_edit_id"]
            isOneToOne: false
            referencedRelation: "park_edits"
            referencedColumns: ["id"]
          },
        ]
      }
      park_info_reports: {
        Row: {
          applied_value: Json | null
          created_at: string
          field: Database["public"]["Enums"]["park_field"]
          id: string
          note: string | null
          obstacle_id: string | null
          park_id: string
          photo_path: string | null
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_value: Json | null
        }
        Insert: {
          applied_value?: Json | null
          created_at?: string
          field: Database["public"]["Enums"]["park_field"]
          id?: string
          note?: string | null
          obstacle_id?: string | null
          park_id: string
          photo_path?: string | null
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          suggested_value?: Json | null
        }
        Update: {
          applied_value?: Json | null
          created_at?: string
          field?: Database["public"]["Enums"]["park_field"]
          id?: string
          note?: string | null
          obstacle_id?: string | null
          park_id?: string
          photo_path?: string | null
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          suggested_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "park_info_reports_obstacle_id_fkey"
            columns: ["obstacle_id"]
            isOneToOne: false
            referencedRelation: "obstacles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_info_reports_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_info_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_info_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      park_photos: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          height: number
          id: string
          license: string
          park_id: string
          photographer: string
          sort_order: number
          source: string
          storage_path: string
          uploaded_by: string
          width: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          height: number
          id?: string
          license?: string
          park_id: string
          photographer?: string
          sort_order?: number
          source?: string
          storage_path: string
          uploaded_by?: string
          width: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          height?: number
          id?: string
          license?: string
          park_id?: string
          photographer?: string
          sort_order?: number
          source?: string
          storage_path?: string
          uploaded_by?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "park_photos_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_photos_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "park_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      park_sessions: {
        Row: {
          days: number[]
          disciplines: Database["public"]["Enums"]["discipline"][]
          end_anchor: Database["public"]["Enums"]["time_anchor"] | null
          end_time: string | null
          id: string
          note: string | null
          park_id: string
          season_end_day: number | null
          season_end_month: number | null
          season_start_day: number | null
          season_start_month: number | null
          start_anchor: Database["public"]["Enums"]["time_anchor"] | null
          start_time: string | null
        }
        Insert: {
          days?: number[]
          disciplines: Database["public"]["Enums"]["discipline"][]
          end_anchor?: Database["public"]["Enums"]["time_anchor"] | null
          end_time?: string | null
          id?: string
          note?: string | null
          park_id: string
          season_end_day?: number | null
          season_end_month?: number | null
          season_start_day?: number | null
          season_start_month?: number | null
          start_anchor?: Database["public"]["Enums"]["time_anchor"] | null
          start_time?: string | null
        }
        Update: {
          days?: number[]
          disciplines?: Database["public"]["Enums"]["discipline"][]
          end_anchor?: Database["public"]["Enums"]["time_anchor"] | null
          end_time?: string | null
          id?: string
          note?: string | null
          park_id?: string
          season_end_day?: number | null
          season_end_month?: number | null
          season_start_day?: number | null
          season_start_month?: number | null
          start_anchor?: Database["public"]["Enums"]["time_anchor"] | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "park_sessions_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      parks: {
        Row: {
          address: string | null
          aliases: string[]
          city: string
          country: string
          created_at: string
          display_name: string
          entry_fee: string | null
          helmet_required: boolean | null
          id: string
          is_paid: boolean
          latitude: number | null
          location: unknown
          longitude: number | null
          metro_area_id: string
          night_lighting: boolean | null
          official_name: string | null
          park_type: Database["public"]["Enums"]["park_type"]
          region: string | null
          setting: Database["public"]["Enums"]["park_setting"] | null
          size_m2: number | null
          slug: string
          status: Database["public"]["Enums"]["park_status"]
          surface: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          address?: string | null
          aliases?: string[]
          city: string
          country: string
          created_at?: string
          display_name: string
          entry_fee?: string | null
          helmet_required?: boolean | null
          id?: string
          is_paid?: boolean
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          metro_area_id: string
          night_lighting?: boolean | null
          official_name?: string | null
          park_type?: Database["public"]["Enums"]["park_type"]
          region?: string | null
          setting?: Database["public"]["Enums"]["park_setting"] | null
          size_m2?: number | null
          slug: string
          status?: Database["public"]["Enums"]["park_status"]
          surface?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          address?: string | null
          aliases?: string[]
          city?: string
          country?: string
          created_at?: string
          display_name?: string
          entry_fee?: string | null
          helmet_required?: boolean | null
          id?: string
          is_paid?: boolean
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          metro_area_id?: string
          night_lighting?: boolean | null
          official_name?: string | null
          park_type?: Database["public"]["Enums"]["park_type"]
          region?: string | null
          setting?: Database["public"]["Enums"]["park_setting"] | null
          size_m2?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["park_status"]
          surface?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parks_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parks_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_slides: {
        Row: {
          duration_s: number | null
          filmer_id: string | null
          height: number
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          obstacle_id: string | null
          obstacle_type: Database["public"]["Enums"]["obstacle_type"] | null
          position: number
          post_id: string
          storage_path: string | null
          stream_video_id: string | null
          upload_status: Database["public"]["Enums"]["upload_status"]
          width: number
        }
        Insert: {
          duration_s?: number | null
          filmer_id?: string | null
          height: number
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          obstacle_id?: string | null
          obstacle_type?: Database["public"]["Enums"]["obstacle_type"] | null
          position: number
          post_id: string
          storage_path?: string | null
          stream_video_id?: string | null
          upload_status?: Database["public"]["Enums"]["upload_status"]
          width: number
        }
        Update: {
          duration_s?: number | null
          filmer_id?: string | null
          height?: number
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          obstacle_id?: string | null
          obstacle_type?: Database["public"]["Enums"]["obstacle_type"] | null
          position?: number
          post_id?: string
          storage_path?: string | null
          stream_video_id?: string | null
          upload_status?: Database["public"]["Enums"]["upload_status"]
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_slides_filmer_id_fkey"
            columns: ["filmer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_slides_obstacle_id_fkey"
            columns: ["obstacle_id"]
            isOneToOne: false
            referencedRelation: "obstacles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_slides_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }
        Insert: {
          anonymized?: boolean
          author_id: string
          caption?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          metro_area_id: string
          park_id?: string | null
          published_at?: string | null
          slide_count?: number
          status?: Database["public"]["Enums"]["post_status"]
        }
        Update: {
          anonymized?: boolean
          author_id?: string
          caption?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          metro_area_id?: string
          park_id?: string | null
          published_at?: string | null
          slide_count?: number
          status?: Database["public"]["Enums"]["post_status"]
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_confirmed_at: string | null
          avatar_path: string | null
          banned_at: string | null
          bio: string | null
          deleted_at: string | null
          disciplines: Database["public"]["Enums"]["discipline"][]
          hide_from_regulars: boolean
          home_metro_area_id: string | null
          home_park_id: string | null
          id: string
          invites_remaining: number
          is_private: boolean
          joined_at: string
          last_active_at: string
          onboarded_at: string | null
          open_to_meetup: boolean
          suspended_until: string | null
          username: string | null
          username_changed_at: string | null
        }
        Insert: {
          age_confirmed_at?: string | null
          avatar_path?: string | null
          banned_at?: string | null
          bio?: string | null
          deleted_at?: string | null
          disciplines?: Database["public"]["Enums"]["discipline"][]
          hide_from_regulars?: boolean
          home_metro_area_id?: string | null
          home_park_id?: string | null
          id: string
          invites_remaining?: number
          is_private?: boolean
          joined_at?: string
          last_active_at?: string
          onboarded_at?: string | null
          open_to_meetup?: boolean
          suspended_until?: string | null
          username?: string | null
          username_changed_at?: string | null
        }
        Update: {
          age_confirmed_at?: string | null
          avatar_path?: string | null
          banned_at?: string | null
          bio?: string | null
          deleted_at?: string | null
          disciplines?: Database["public"]["Enums"]["discipline"][]
          hide_from_regulars?: boolean
          home_metro_area_id?: string | null
          home_park_id?: string | null
          id?: string
          invites_remaining?: number
          is_private?: boolean
          joined_at?: string
          last_active_at?: string
          onboarded_at?: string | null
          open_to_meetup?: boolean
          suspended_until?: string | null
          username?: string | null
          username_changed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_home_metro_area_id_fkey"
            columns: ["home_metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_home_park_id_fkey"
            columns: ["home_park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          action: Database["public"]["Enums"]["report_action"] | null
          comment_id: string | null
          created_at: string
          details: string | null
          id: string
          post_id: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_user_id: string | null
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          action?: Database["public"]["Enums"]["report_action"] | null
          comment_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_user_id?: string | null
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["report_action"] | null
          comment_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reported_user_id?: string | null
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_usernames: {
        Row: {
          created_at: string
          reserved_until: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          reserved_until: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          reserved_until?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "reserved_usernames_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_assignments: {
        Row: {
          accepted_at: string | null
          badge_hidden: boolean
          created_at: string
          ended_at: string | null
          ended_reason: string | null
          granted_by: string | null
          id: string
          metro_area_id: string | null
          park_id: string | null
          role: Database["public"]["Enums"]["role_name"]
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          badge_hidden?: boolean
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          granted_by?: string | null
          id?: string
          metro_area_id?: string | null
          park_id?: string | null
          role: Database["public"]["Enums"]["role_name"]
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          badge_hidden?: boolean
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          granted_by?: string | null
          id?: string
          metro_area_id?: string | null
          park_id?: string | null
          role?: Database["public"]["Enums"]["role_name"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_log: {
        Row: {
          action: string
          actor_id: string | null
          assignment_id: string
          created_at: string
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          assignment_id: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          assignment_id?: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_change_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_change_log_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "role_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_parks: {
        Row: {
          created_at: string
          park_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          park_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          park_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_parks_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_parks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      slide_people_tags: {
        Row: {
          created_at: string
          slide_id: string
          tagged_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          slide_id: string
          tagged_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          slide_id?: string
          tagged_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slide_people_tags_slide_id_fkey"
            columns: ["slide_id"]
            isOneToOne: false
            referencedRelation: "post_slides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slide_people_tags_tagged_by_fkey"
            columns: ["tagged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slide_people_tags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      park_regulars: {
        Row: {
          last_active_at: string | null
          park_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      before_user_created: { Args: { event: Json }; Returns: Json }
      cancel_invite: { Args: { invite: string }; Returns: undefined }
      comment_count: {
        Args: { "": Database["public"]["Tables"]["posts"]["Row"] }
        Returns: number
      }
      confirm_age: { Args: never; Returns: undefined }
      create_invite: {
        Args: never
        Returns: {
          code: string
          expires_at: string
          id: string
        }[]
      }
      feed_following: {
        Args: { before_at?: string; before_id?: string; max_results?: number }
        Returns: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      feed_nearby: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          metro?: string
        }
        Returns: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      filmed_posts: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          person: string
        }
        Returns: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      invite_preview: {
        Args: { code: string }
        Returns: {
          inviter_username: string
        }[]
      }
      liked_by_me: {
        Args: { "": Database["public"]["Tables"]["posts"]["Row"] }
        Returns: boolean
      }
      mark_notifications_seen: { Args: never; Returns: undefined }
      my_account: {
        Args: never
        Returns: {
          age_confirmed_at: string
          banned_at: string
          invites_remaining: number
          suspended_until: string
        }[]
      }
      my_blocked_accounts: {
        Args: never
        Returns: {
          avatar_path: string | null
          blocked_at: string
          id: string
          username: string
        }[]
      }
      my_follow_requests: {
        Args: never
        Returns: {
          avatar_path: string | null
          disciplines: Database["public"]["Enums"]["discipline"][]
          follower_id: string
          requested_at: string
          username: string
        }[]
      }
      my_invite_count: { Args: never; Returns: number }
      my_invites: {
        Args: never
        Returns: {
          code: string
          created_at: string
          expires_at: string
          id: string
          invites_remaining: number
          state: string
          used_at: string | null
          used_by_username: string | null
        }[]
      }
      my_notifications: {
        Args: never
        Returns: {
          actor_count: number
          actors: Json
          comment_body: string | null
          comment_id: string | null
          created_at: string
          id: string
          kind: string
          metro_name: string | null
          park_name: string | null
          park_slug: string | null
          post_id: string | null
          unread: boolean
        }[]
      }
      my_park_role: {
        Args: { park: string }
        Returns: Database["public"]["Enums"]["role_name"]
      }
      notifications_unread: { Args: never; Returns: boolean }
      obstacle_posts: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          obstacle: string
        }
        Returns: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      park_regulars_list: {
        Args: { max_results?: number; park: string }
        Returns: {
          avatar_path: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          id: string
          last_active_at: string
          username: string
        }[]
      }
      parks_near: {
        Args: { lat: number; lng: number; max_results?: number }
        Returns: {
          city: string
          display_name: string
          distance_m: number
          id: string
          latitude: number
          longitude: number
          night_lighting: boolean
          park_type: Database["public"]["Enums"]["park_type"]
          setting: Database["public"]["Enums"]["park_setting"]
          slug: string
          status: Database["public"]["Enums"]["park_status"]
        }[]
      }
      post_comments: {
        Args: { post: string }
        Returns: {
          author_id: string | null
          avatar_path: string | null
          body: string | null
          created_at: string
          deleted: boolean
          id: string
          is_poster: boolean
          parent_id: string | null
          reply_to_username: string | null
          username: string | null
        }[]
      }
      redeem_my_invite: { Args: never; Returns: string | null }
      remove_my_filmer_credit: { Args: { slide: string }; Returns: undefined }
      reorder_park_photos: {
        Args: { park: string; photo_ids: string[] }
        Returns: undefined
      }
      search_directory: {
        Args: { max_results?: number; q: string }
        Returns: {
          country: string
          detail: string
          id: string
          kind: string
          matched_alias: string
          metro_area_id: string
          name: string
          park_count: number
          park_type: Database["public"]["Enums"]["park_type"]
          slug: string
          status: Database["public"]["Enums"]["park_status"]
        }[]
      }
      search_people: {
        Args: { max_results?: number; q: string }
        Returns: {
          disciplines: Database["public"]["Enums"]["discipline"][]
          follow_status: Database["public"]["Enums"]["follow_status"] | null
          home_metro_name: string | null
          home_park_name: string | null
          id: string
          is_private: boolean
          username: string
        }[]
      }
      set_slide_tags: {
        Args: {
          filmer?: string
          obstacle?: string
          obstacle_kind?: Database["public"]["Enums"]["obstacle_type"]
          people?: string[]
          slide: string
        }
        Returns: undefined
      }
      tagged_posts: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          person: string
        }
        Returns: {
          anonymized: boolean
          author_id: string
          caption: string | null
          created_at: string
          edited_at: string | null
          id: string
          metro_area_id: string
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      username_available: { Args: { name: string }; Returns: boolean }
    }
    Enums: {
      announcement_kind: "joined" | "visiting"
      discipline: "inline" | "quad" | "skateboard" | "bmx" | "scooter"
      follow_status: "pending" | "accepted"
      media_kind: "photo" | "video"
      notification_kind:
        | "comment"
        | "tag"
        | "filmer_credit"
        | "invite_used"
        | "park_report_accepted"
        | "role_invite"
      obstacle_status: "pending" | "active" | "archived"
      obstacle_type:
        | "rail"
        | "ledge"
        | "hubba"
        | "manual_pad"
        | "stairs"
        | "gap"
        | "bank"
        | "pyramid"
        | "fun_box"
        | "box"
        | "hip"
        | "quarter_pipe"
        | "kicker"
        | "mini_ramp"
        | "half_pipe"
        | "vert_ramp"
        | "spine"
        | "bump"
        | "volcano"
        | "bowl"
        | "pool"
        | "snake_run"
        | "ditch"
        | "full_pipe"
        | "pump_track"
        | "pole_jam"
        | "rainbow_bench"
        | "other"
        | "street_plaza"
      park_field:
        | "hours"
        | "status"
        | "lighting"
        | "location"
        | "fees"
        | "disciplines"
        | "helmet_rule"
        | "description"
        | "obstacle"
        | "other"
      park_setting: "indoor" | "outdoor" | "covered_outdoor"
      park_status:
        | "open"
        | "temporarily_closed"
        | "seasonal_closure"
        | "coming_soon"
      park_type: "skatepark" | "pump_track" | "diy"
      post_status: "visible" | "auto_hidden" | "hidden" | "deleted"
      report_action:
        | "dismiss"
        | "hide_post"
        | "warn"
        | "suspend"
        | "escalate"
        | "ban"
      report_reason:
        | "harassment"
        | "involves_minor"
        | "spam"
        | "inappropriate"
        | "other"
      report_status: "open" | "dismissed" | "actioned" | "escalated"
      review_status: "open" | "accepted" | "rejected"
      role_name: "owner" | "city_admin" | "park_admin" | "park_contributor"
      text_source: "author" | "machine"
      time_anchor: "clock" | "sunrise" | "sunset"
      upload_status: "uploading" | "processing" | "ready" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      announcement_kind: ["joined", "visiting"],
      discipline: ["inline", "quad", "skateboard", "bmx", "scooter"],
      follow_status: ["pending", "accepted"],
      media_kind: ["photo", "video"],
      notification_kind: [
        "comment",
        "tag",
        "filmer_credit",
        "invite_used",
        "park_report_accepted",
        "role_invite",
      ],
      obstacle_status: ["pending", "active", "archived"],
      obstacle_type: [
        "rail",
        "ledge",
        "hubba",
        "manual_pad",
        "stairs",
        "gap",
        "bank",
        "pyramid",
        "fun_box",
        "box",
        "hip",
        "quarter_pipe",
        "kicker",
        "mini_ramp",
        "half_pipe",
        "vert_ramp",
        "spine",
        "bump",
        "volcano",
        "bowl",
        "pool",
        "snake_run",
        "ditch",
        "full_pipe",
        "pump_track",
        "pole_jam",
        "rainbow_bench",
        "other",
        "street_plaza",
      ],
      park_field: [
        "hours",
        "status",
        "lighting",
        "location",
        "fees",
        "disciplines",
        "helmet_rule",
        "description",
        "obstacle",
        "other",
      ],
      park_setting: ["indoor", "outdoor", "covered_outdoor"],
      park_status: [
        "open",
        "temporarily_closed",
        "seasonal_closure",
        "coming_soon",
      ],
      park_type: ["skatepark", "pump_track", "diy"],
      post_status: ["visible", "auto_hidden", "hidden", "deleted"],
      report_action: [
        "dismiss",
        "hide_post",
        "warn",
        "suspend",
        "escalate",
        "ban",
      ],
      report_reason: [
        "harassment",
        "involves_minor",
        "spam",
        "inappropriate",
        "other",
      ],
      report_status: ["open", "dismissed", "actioned", "escalated"],
      review_status: ["open", "accepted", "rejected"],
      role_name: ["owner", "city_admin", "park_admin", "park_contributor"],
      text_source: ["author", "machine"],
      time_anchor: ["clock", "sunrise", "sunset"],
      upload_status: ["uploading", "processing", "ready", "failed"],
    },
  },
} as const
