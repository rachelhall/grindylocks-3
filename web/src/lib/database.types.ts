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
      access_requests: {
        Row: {
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          dismissed_at: string | null
          email: string
          home_city: string | null
          id: string
          invited_at: string | null
        }
        Insert: {
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          dismissed_at?: string | null
          email: string
          home_city?: string | null
          id?: string
          invited_at?: string | null
        }
        Update: {
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          dismissed_at?: string | null
          email?: string
          home_city?: string | null
          id?: string
          invited_at?: string | null
        }
        Relationships: []
      }
      admin_seen: {
        Row: {
          page: string
          seen_at: string
          user_id: string
        }
        Insert: {
          page: string
          seen_at?: string
          user_id: string
        }
        Update: {
          page?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_seen_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      check_ins: {
        Row: {
          audience: Database["public"]["Enums"]["check_in_audience"]
          ends_at: string
          park_id: string
          started_at: string
          user_id: string
        }
        Insert: {
          audience?: Database["public"]["Enums"]["check_in_audience"]
          ends_at: string
          park_id: string
          started_at?: string
          user_id: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["check_in_audience"]
          ends_at?: string
          park_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_id: string | null
          page_id: string | null
          post_id: string
          reply_to_page_id: string | null
          reply_to_user_id: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          page_id?: string | null
          post_id: string
          reply_to_page_id?: string | null
          reply_to_user_id?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          page_id?: string | null
          post_id?: string
          reply_to_page_id?: string | null
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
      event_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          event_id: string
          id: string
          page_id: string | null
          parent_id: string | null
          reply_to_user_id: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          event_id: string
          id?: string
          page_id?: string | null
          parent_id?: string | null
          reply_to_user_id?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string
          id?: string
          page_id?: string | null
          parent_id?: string | null
          reply_to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "event_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_comments_reply_to_user_id_fkey"
            columns: ["reply_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_days: {
        Row: {
          day: string
          ends_at: string
          event_id: string
          starts_at: string
        }
        Insert: {
          day: string
          ends_at: string
          event_id: string
          starts_at: string
        }
        Update: {
          day?: string
          ends_at?: string
          event_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_days_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_going: {
        Row: {
          confirmed_adult_at: string | null
          created_at: string
          event_id: string
          going_privately: boolean
          remind_me: boolean
          reminded_at: string | null
          user_id: string
        }
        Insert: {
          confirmed_adult_at?: string | null
          created_at?: string
          event_id: string
          going_privately?: boolean
          remind_me?: boolean
          reminded_at?: string | null
          user_id: string
        }
        Update: {
          confirmed_adult_at?: string | null
          created_at?: string
          event_id?: string
          going_privately?: boolean
          remind_me?: boolean
          reminded_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_going_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_going_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_hosts: {
        Row: {
          accepted_at: string | null
          created_at: string
          invited_by: string | null
          role: Database["public"]["Enums"]["meetup_host_role"]
          series_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["meetup_host_role"]
          series_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["meetup_host_role"]
          series_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_hosts_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_hosts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_hosts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_parks: {
        Row: {
          event_id: string
          hidden_at: string | null
          hidden_by: string | null
          park_id: string
          position: number
        }
        Insert: {
          event_id: string
          hidden_at?: string | null
          hidden_by?: string | null
          park_id: string
          position: number
        }
        Update: {
          event_id?: string
          hidden_at?: string | null
          hidden_by?: string | null
          park_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_parks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_parks_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_parks_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          address: string | null
          adults_only: boolean
          capacity: number | null
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          place: Database["public"]["Enums"]["meetup_place"]
          ticket_url: string | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          duration: string
          ended_at: string | null
          ends_on: string | null
          host_id: string | null
          host_page_id: string | null
          id: string
          note: string | null
          park_id: string | null
          start_time: string
          starts_on: string
          title: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["meetup_visibility"]
          weekdays: number[]
          who_for: string | null
        }
        Insert: {
          address?: string | null
          adults_only?: boolean
          capacity?: number | null
          latitude?: number | null
          longitude?: number | null
          metro_area_id?: string | null
          multi_day?: boolean
          place?: Database["public"]["Enums"]["meetup_place"]
          ticket_url?: string | null
          cover_path?: string | null
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          duration: string
          ended_at?: string | null
          ends_on?: string | null
          host_id?: string | null
          host_page_id?: string | null
          id?: string
          note?: string | null
          park_id?: string | null
          start_time: string
          starts_on: string
          title?: string | null
          updated_at?: string
          visibility: Database["public"]["Enums"]["meetup_visibility"]
          weekdays?: number[]
          who_for?: string | null
        }
        Update: {
          address?: string | null
          adults_only?: boolean
          capacity?: number | null
          latitude?: number | null
          longitude?: number | null
          metro_area_id?: string | null
          multi_day?: boolean
          place?: Database["public"]["Enums"]["meetup_place"]
          ticket_url?: string | null
          cover_path?: string | null
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          duration?: string
          ended_at?: string | null
          ends_on?: string | null
          host_id?: string | null
          host_page_id?: string | null
          id?: string
          note?: string | null
          park_id?: string | null
          start_time?: string
          starts_on?: string
          title?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["meetup_visibility"]
          weekdays?: number[]
          who_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_series_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series_parks: {
        Row: {
          park_id: string
          position: number
          series_id: string
        }
        Insert: {
          park_id: string
          position: number
          series_id: string
        }
        Update: {
          park_id?: string
          position?: number
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_series_parks_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_parks_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series_follows: {
        Row: {
          created_at: string
          series_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          series_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          series_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_series_follows_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series_seasons: {
        Row: {
          from_month: number
          id: string
          park_id: string
          series_id: string
          to_month: number
        }
        Insert: {
          from_month: number
          id?: string
          park_id: string
          series_id: string
          to_month: number
        }
        Update: {
          from_month?: number
          id?: string
          park_id?: string
          series_id?: string
          to_month?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_series_seasons_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_seasons_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          adults_only: boolean
          capacity: number | null
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
          feed_at: string | null
          going_faces: Json | null
          going_total: number | null
          host_list: Json | null
          i_am_going: boolean | null
          linked_post_count: number | null
          meetup_comment_count: number | null
          i_run_meetup: boolean | null
          meetup_days: Json | null
          meetup_host_page: Json | null
          meetup_official: boolean | null
          meetup_place_info: Json | null
          meetup_timezone: string | null
          spots_taken: number | null
        }
        Insert: {
          address?: string | null
          adults_only?: boolean
          capacity?: number | null
          cancel_note?: string | null
          cancel_reason?:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at?: string | null
          cover_path?: string | null
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metro_area_id?: string | null
          multi_day?: boolean
          note?: string | null
          park_id?: string | null
          place?: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["meetup_status"]
          ticket_url?: string | null
          title?: string | null
          updated_at?: string
          went_count?: number | null
          who_for?: string | null
        }
        Update: {
          address?: string | null
          adults_only?: boolean
          capacity?: number | null
          cancel_note?: string | null
          cancel_reason?:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at?: string | null
          cover_path?: string | null
          created_at?: string
          disciplines?: Database["public"]["Enums"]["discipline"][]
          ends_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metro_area_id?: string | null
          multi_day?: boolean
          note?: string | null
          park_id?: string | null
          place?: Database["public"]["Enums"]["meetup_place"]
          series_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["meetup_status"]
          ticket_url?: string | null
          title?: string | null
          updated_at?: string
          went_count?: number | null
          who_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
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
          slug: string
          timezone: string | null
        }
        Insert: {
          country: string
          created_at?: string
          id?: string
          name: string
          region?: string | null
          slug?: string
          timezone?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          name?: string
          region?: string | null
          slug?: string
          timezone?: string | null
        }
        Relationships: []
      }
      moderation_actions: {
        Row: {
          action: string
          actor_id: string
          comment_id: string | null
          created_at: string
          event_comment_id: string | null
          event_id: string | null
          id: string
          message: string | null
          obstacle_id: string | null
          park_id: string | null
          page_id: string | null
          park_info_report_id: string | null
          post_id: string | null
          report_ids: string[]
          snapshot: Json | null
          subject_id: string | null
          suspended_until: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          message?: string | null
          obstacle_id?: string | null
          park_id?: string | null
          page_id?: string | null
          park_info_report_id?: string | null
          post_id?: string | null
          report_ids?: string[]
          snapshot?: Json | null
          subject_id?: string | null
          suspended_until?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          message?: string | null
          obstacle_id?: string | null
          park_id?: string | null
          page_id?: string | null
          park_info_report_id?: string | null
          post_id?: string | null
          report_ids?: string[]
          snapshot?: Json | null
          subject_id?: string | null
          suspended_until?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_obstacle_id_fkey"
            columns: ["obstacle_id"]
            isOneToOne: false
            referencedRelation: "obstacles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_park_id_fkey"
            columns: ["park_id"]
            isOneToOne: false
            referencedRelation: "parks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_park_info_report_id_fkey"
            columns: ["park_info_report_id"]
            isOneToOne: false
            referencedRelation: "park_info_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          actor_page_id: string | null
          comment_id: string | null
          created_at: string
          event_comment_id: string | null
          event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          message: string | null
          page_id: string | null
          park_id: string | null
          post_id: string | null
          read_at: string | null
          recipient_id: string
          series_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_page_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          message?: string | null
          page_id?: string | null
          park_id?: string | null
          post_id?: string | null
          read_at?: string | null
          recipient_id: string
          series_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_page_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          message?: string | null
          page_id?: string | null
          park_id?: string | null
          post_id?: string | null
          read_at?: string | null
          recipient_id?: string
          series_id?: string | null
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
      page_aliases: {
        Row: {
          created_at: string
          formerly: boolean
          handle: string | null
          id: string
          name: string
          page_id: string
          redirect_until: string | null
        }
        Insert: {
          created_at?: string
          formerly?: boolean
          handle?: string | null
          id?: string
          name: string
          page_id: string
          redirect_until?: string | null
        }
        Update: {
          created_at?: string
          formerly?: boolean
          handle?: string | null
          id?: string
          name?: string
          page_id?: string
          redirect_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_aliases_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_blocks: {
        Row: {
          blocked_by: string | null
          created_at: string
          id: string
          lifted_at: string | null
          lifted_by: string | null
          page_id: string
          user_id: string
        }
        Insert: {
          blocked_by?: string | null
          created_at?: string
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          page_id: string
          user_id: string
        }
        Update: {
          blocked_by?: string | null
          created_at?: string
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_blocks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_blocks_lifted_by_fkey"
            columns: ["lifted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_brands_carried: {
        Row: {
          brand_id: string
          position: number
          shop_id: string
        }
        Insert: {
          brand_id: string
          position?: number
          shop_id: string
        }
        Update: {
          brand_id?: string
          position?: number
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_brands_carried_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_brands_carried_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_descriptions: {
        Row: {
          body: string
          locale: string
          page_id: string
          source: Database["public"]["Enums"]["text_source"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          locale: string
          page_id: string
          source?: Database["public"]["Enums"]["text_source"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          locale?: string
          page_id?: string
          source?: Database["public"]["Enums"]["text_source"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_descriptions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_descriptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_follows: {
        Row: {
          created_at: string
          page_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          page_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_follows_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_hours: {
        Row: {
          days: number[]
          end_anchor: Database["public"]["Enums"]["time_anchor"]
          end_time: string | null
          id: string
          note: string | null
          page_id: string
          season_end_day: number | null
          season_end_month: number | null
          season_start_day: number | null
          season_start_month: number | null
          start_anchor: Database["public"]["Enums"]["time_anchor"]
          start_time: string | null
        }
        Insert: {
          days: number[]
          end_anchor?: Database["public"]["Enums"]["time_anchor"]
          end_time?: string | null
          id?: string
          note?: string | null
          page_id: string
          season_end_day?: number | null
          season_end_month?: number | null
          season_start_day?: number | null
          season_start_month?: number | null
          start_anchor?: Database["public"]["Enums"]["time_anchor"]
          start_time?: string | null
        }
        Update: {
          days?: number[]
          end_anchor?: Database["public"]["Enums"]["time_anchor"]
          end_time?: string | null
          id?: string
          note?: string | null
          page_id?: string
          season_end_day?: number | null
          season_end_month?: number | null
          season_start_day?: number | null
          season_start_month?: number | null
          start_anchor?: Database["public"]["Enums"]["time_anchor"]
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_hours_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_claims: {
        Row: {
          checked_at: string | null
          created_at: string
          decided_at: string | null
          decline_reason: string | null
          email: string | null
          email_code_expires_at: string | null
          email_code_sent_at: string | null
          email_confirmed_at: string | null
          email_domain_matches: boolean | null
          id: string
          note: string | null
          page_id: string
          posted_code: string | null
          posted_code_expires_at: string | null
          posted_url: string | null
          proof: Database["public"]["Enums"]["page_claim_proof"]
          role_title: string
          sent_at: string | null
          status: Database["public"]["Enums"]["page_claim_status"]
          user_id: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          email?: string | null
          email_code_expires_at?: string | null
          email_code_sent_at?: string | null
          email_confirmed_at?: string | null
          email_domain_matches?: boolean | null
          id?: string
          note?: string | null
          page_id?: string
          posted_code?: string | null
          posted_code_expires_at?: string | null
          posted_url?: string | null
          proof?: Database["public"]["Enums"]["page_claim_proof"]
          role_title?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["page_claim_status"]
          user_id?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          email?: string | null
          email_code_expires_at?: string | null
          email_code_sent_at?: string | null
          email_confirmed_at?: string | null
          email_domain_matches?: boolean | null
          id?: string
          note?: string | null
          page_id?: string
          posted_code?: string | null
          posted_code_expires_at?: string | null
          posted_url?: string | null
          proof?: Database["public"]["Enums"]["page_claim_proof"]
          role_title?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["page_claim_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_claims_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancelled_at: string | null
          code: string | null
          created_at: string
          declined_at: string | null
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          invitee_id: string | null
          kind: Database["public"]["Enums"]["page_invite_kind"]
          logo_path: string | null
          page_id: string
          role: Database["public"]["Enums"]["page_member_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          code?: string | null
          created_at?: string
          declined_at?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          invitee_id?: string | null
          kind: Database["public"]["Enums"]["page_invite_kind"]
          logo_path?: string | null
          page_id: string
          role?: Database["public"]["Enums"]["page_member_role"] | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          code?: string | null
          created_at?: string
          declined_at?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          invitee_id?: string | null
          kind?: Database["public"]["Enums"]["page_invite_kind"]
          logo_path?: string | null
          page_id?: string
          role?: Database["public"]["Enums"]["page_member_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "page_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_invites_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_invites_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_links: {
        Row: {
          page_id: string
          position: number
          url: string
        }
        Insert: {
          page_id: string
          position: number
          url: string
        }
        Update: {
          page_id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_links_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_members: {
        Row: {
          inbox_push: boolean
          invited_by: string | null
          joined_at: string
          page_id: string
          role: Database["public"]["Enums"]["page_member_role"]
          user_id: string
        }
        Insert: {
          inbox_push?: boolean
          invited_by?: string | null
          joined_at?: string
          page_id: string
          role: Database["public"]["Enums"]["page_member_role"]
          user_id: string
        }
        Update: {
          inbox_push?: boolean
          invited_by?: string | null
          joined_at?: string
          page_id?: string
          role?: Database["public"]["Enums"]["page_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_members_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_mentions: {
        Row: {
          author_id: string | null
          by_page_id: string | null
          comment_id: string | null
          created_at: string
          event_comment_id: string | null
          id: string
          page_id: string
          post_id: string | null
        }
        Insert: {
          author_id?: string | null
          by_page_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          id?: string
          page_id: string
          post_id?: string | null
        }
        Update: {
          author_id?: string | null
          by_page_id?: string | null
          comment_id?: string | null
          created_at?: string
          event_comment_id?: string | null
          id?: string
          page_id?: string
          post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_mentions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_mentions_event_comment_id_fkey"
            columns: ["event_comment_id"]
            isOneToOne: false
            referencedRelation: "event_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_mentions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      page_mutes: {
        Row: {
          created_at: string
          page_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          page_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_mutes_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          page_id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          page_id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          page_id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "page_reports_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_fix_reports: {
        Row: {
          created_at: string
          escalated_at: string | null
          field: Database["public"]["Enums"]["page_fix_field"]
          id: string
          note: string | null
          page_id: string
          reporter_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          value: string | null
        }
        Insert: {
          created_at?: string
          escalated_at?: string | null
          field: Database["public"]["Enums"]["page_fix_field"]
          id?: string
          note?: string | null
          page_id: string
          reporter_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          value?: string | null
        }
        Update: {
          created_at?: string
          escalated_at?: string | null
          field?: Database["public"]["Enums"]["page_fix_field"]
          id?: string
          note?: string | null
          page_id?: string
          reporter_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_fix_reports_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_fix_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_fix_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_suggestions: {
        Row: {
          created_at: string
          id: string
          link: string | null
          name: string
          outcome: string | null
          page_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role: Database["public"]["Enums"]["page_role"]
          status: Database["public"]["Enums"]["review_status"]
          suggester_id: string | null
          what: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          name: string
          outcome?: string | null
          page_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role: Database["public"]["Enums"]["page_role"]
          status?: Database["public"]["Enums"]["review_status"]
          suggester_id?: string | null
          what?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          name?: string
          outcome?: string | null
          page_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: Database["public"]["Enums"]["page_role"]
          status?: Database["public"]["Enums"]["review_status"]
          suggester_id?: string | null
          what?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_suggestions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_suggestions_suggester_id_fkey"
            columns: ["suggester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          address: string | null
          city: string | null
          closed_at: string | null
          country: string | null
          created_at: string
          created_by: string | null
          display_name: string
          ended_label: string | null
          founded_label: string | null
          followers_told_at: string | null
          founding_partner_at: string | null
          frozen_at: string | null
          handle: string
          header_path: string | null
          id: string
          latitude: number | null
          location: unknown
          location_type:
            | Database["public"]["Enums"]["shop_location_type"]
            | null
          logo_path: string | null
          longitude: number | null
          main_language: string
          managed_at: string | null
          needs_translations_at: string | null
          metro_area_id: string | null
          region: string | null
          roles: Database["public"]["Enums"]["page_role"][]
          show_pin: boolean
          state: Database["public"]["Enums"]["page_state"]
          suspended_at: string | null
          suspended_reason: string | null
          temp_closed_at: string | null
          temp_closed_note: string | null
          temp_closed_until: string | null
          timezone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          closed_at?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          display_name: string
          ended_label?: string | null
          founded_label?: string | null
          followers_told_at?: string | null
          founding_partner_at?: string | null
          frozen_at?: string | null
          handle: string
          header_path?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          location_type?:
            | Database["public"]["Enums"]["shop_location_type"]
            | null
          logo_path?: string | null
          longitude?: number | null
          main_language?: string
          managed_at?: string | null
          needs_translations_at?: string | null
          metro_area_id?: string | null
          region?: string | null
          roles: Database["public"]["Enums"]["page_role"][]
          show_pin?: boolean
          state?: Database["public"]["Enums"]["page_state"]
          suspended_at?: string | null
          suspended_reason?: string | null
          temp_closed_at?: string | null
          temp_closed_note?: string | null
          temp_closed_until?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          closed_at?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          ended_label?: string | null
          founded_label?: string | null
          followers_told_at?: string | null
          founding_partner_at?: string | null
          frozen_at?: string | null
          handle?: string
          header_path?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          location_type?:
            | Database["public"]["Enums"]["shop_location_type"]
            | null
          logo_path?: string | null
          longitude?: number | null
          main_language?: string
          managed_at?: string | null
          needs_translations_at?: string | null
          metro_area_id?: string | null
          region?: string | null
          roles?: Database["public"]["Enums"]["page_role"][]
          show_pin?: boolean
          state?: Database["public"]["Enums"]["page_state"]
          suspended_at?: string | null
          suspended_reason?: string | null
          temp_closed_at?: string | null
          temp_closed_note?: string | null
          temp_closed_until?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
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
          run_by_page_id: string | null
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
          run_by_page_id?: string | null
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
          run_by_page_id?: string | null
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
            foreignKeyName: "parks_run_by_page_id_fkey"
            columns: ["run_by_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
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
          frame_x: number
          frame_y: number
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
          frame_x?: number
          frame_y?: number
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
          frame_x?: number
          frame_y?: number
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
          author_id: string | null
          caption: string | null
          created_at: string
          edited_at: string | null
          event_id: string | null
          id: string
          metro_area_id: string | null
          near_you: boolean
          page_id: string | null
          park_id: string | null
          published_at: string | null
          slide_count: number
          status: Database["public"]["Enums"]["post_status"]
          comment_count: number | null
          liked_by_me: boolean | null
        }
        Insert: {
          anonymized?: boolean
          author_id?: string | null
          caption?: string | null
          created_at?: string
          edited_at?: string | null
          event_id?: string | null
          id?: string
          metro_area_id?: string | null
          near_you?: boolean
          page_id?: string | null
          park_id?: string | null
          published_at?: string | null
          slide_count?: number
          status?: Database["public"]["Enums"]["post_status"]
        }
        Update: {
          anonymized?: boolean
          author_id?: string | null
          caption?: string | null
          created_at?: string
          edited_at?: string | null
          event_id?: string | null
          id?: string
          metro_area_id?: string | null
          near_you?: boolean
          page_id?: string | null
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
            foreignKeyName: "posts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
            foreignKeyName: "posts_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
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
          going_privately_default: boolean | null
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
          going_privately_default?: boolean | null
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
          going_privately_default?: boolean | null
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
          event_comment_id: string | null
          event_id: string | null
          id: string
          impersonated_page_id: string | null
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
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          impersonated_page_id?: string | null
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
          event_comment_id?: string | null
          event_id?: string | null
          id?: string
          impersonated_page_id?: string | null
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
            foreignKeyName: "reports_impersonated_page_id_fkey"
            columns: ["impersonated_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
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
      user_page_blocks: {
        Row: {
          created_at: string
          page_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          page_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_page_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_page_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      catalog_entries: {
        Row: {
          base_id: string | null
          disciplines: Database["public"]["Enums"]["discipline"][] | null
          edition: string | null
          entry_type: Database["public"]["Enums"]["product_entry_type"] | null
          family: string | null
          first_year: string | null
          id: string | null
          includes_frame: boolean | null
          name: string | null
          page_handle: string | null
          page_id: string | null
          page_name: string | null
          part_type: string | null
          partner_handle: string | null
          partner_name: string | null
          partner_page_id: string | null
          pro_rider: string | null
          sort: number | null
          status: Database["public"]["Enums"]["product_status"] | null
        }
        Relationships: []
      }
      park_regulars: {
        Row: {
          last_active_at: string | null
          park_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      product_stock_setup: {
        Row: {
          part_id: string | null
          part_name: string | null
          part_page_id: string | null
          part_page_name: string | null
          part_type: string | null
          part_type_sort: number | null
          product_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_close_page: {
        Args: { ended?: string; founded?: string; page: string }
        Returns: string
      }
      admin_handle_check: {
        Args: { handle: string; page?: string }
        Returns: string
      }
      admin_page_detail: { Args: { page: string }; Returns: Json }
      admin_pages: {
        Args: { kind?: string; q?: string }
        Returns: {
          city: string | null
          closed_at: string | null
          country: string | null
          display_name: string
          ended_label: string | null
          followers: number
          founded_label: string | null
          frozen: boolean
          handle: string
          has_logo: boolean
          id: string
          matched_alias: string | null
          open_claims: number
          owner_username: string | null
          roles: string[]
          state: string
          suspended_at: string | null
          team_count: number
        }[]
      }
      admin_rename_page: {
        Args: {
          display_name: string
          handle: string
          keep_formerly?: boolean
          page: string
        }
        Returns: undefined
      }
      admin_transfer_page: {
        Args: {
          new_owner?: string
          note?: string
          old_owner_stays?: boolean
          page: string
          username?: string
        }
        Returns: string
      }
      answer_page_invite: {
        Args: { accept: boolean; invite: string }
        Returns: string
      }
      cancel_page_invite: { Args: { invite: string }; Returns: undefined }
      decide_page_claim: {
        Args: { approve: boolean; claim: string; reason?: string }
        Returns: undefined
      }
      i_run_meetup: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      invite_to_page: {
        Args: {
          language?: string
          page: string
          role: Database["public"]["Enums"]["page_member_role"]
          who: string
        }
        Returns: string
      }
      lift_page_suspension: { Args: { page: string }; Returns: number }
      meetup_days: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      meetup_host_page: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json | null
      }
      meetup_official: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      meetup_place_info: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      meetup_stops: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      meetup_timezone: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: string | null
      }
      merge_pages: {
        Args: { confirm: string; source: string; target: string }
        Returns: Json
      }
      merge_preview: { Args: { source: string; target: string }; Returns: Json }
      my_page_invites: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          id: string
          inviter_avatar_path: string | null
          inviter_username: string | null
          kind: string
          my_role: string | null
          page_city: string | null
          page_country: string | null
          page_handle: string
          page_id: string
          page_logo_path: string | null
          page_name: string
          page_roles: string[]
          page_state: string
          role: string | null
        }[]
      }
      my_page_notifications: {
        Args: never
        Returns: {
          actor_avatar_path: string | null
          actor_username: string | null
          created_at: string
          following: boolean
          id: string
          kind: string
          message: string | null
          page_handle: string
          page_id: string
          page_logo_path: string | null
          page_name: string
          page_roles: string[]
          page_state: string
          unread: boolean
        }[]
      }
      my_page_onboarding: {
        Args: never
        Returns: {
          city: string | null
          display_name: string
          handle: string
          metro_area_id: string | null
          needs_logo: boolean
          page_id: string
          role: string
          roles: string[]
        }[]
      }
      my_pages: {
        Args: never
        Returns: {
          display_name: string
          handle: string
          inbox_new: number
          inbox_push: boolean
          logo_path: string | null
          page_id: string
          role: string
          roles: string[]
          state: string
        }[]
      }
      my_owned_pages: {
        Args: never
        Returns: {
          declined_username: string | null
          display_name: string
          handle: string
          handover_id: string | null
          handover_username: string | null
          logo_path: string | null
          page_id: string
          roles: string[]
          state: string
          team_size: number
        }[]
      }
      page_email_claim: {
        Args: { max_rows?: number }
        Returns: {
          code: string | null
          email_id: number
          expires_at: string | null
          inviter_username: string | null
          kind: string
          language: string
          page_handle: string
          page_kind: string
          page_name: string
          page_place: string | null
          role: string | null
          send: boolean
          to_email: string
        }[]
      }
      page_email_done: { Args: { ids: number[] }; Returns: undefined }
      page_invite_preview: {
        Args: { code: string }
        Returns: {
          email: string | null
          expires_at: string
          inviter_username: string | null
          kind: string
          page_city: string | null
          page_country: string | null
          page_handle: string
          page_logo_path: string | null
          page_name: string
          page_roles: string[]
          page_state: string
          role: string | null
        }[]
      }
      page_meetups: {
        Args: { max_results?: number; page: string }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      page_suspension_notice: {
        Args: { page: string }
        Returns: {
          reason: string
          suspended_at: string
        }[]
      }
      public_metro: { Args: { metro_slug: string }; Returns: Json }
      public_metro_areas: {
        Args: never
        Returns: {
          country: string
          name: string
          park_count: number
          region: string | null
          slug: string
        }[]
      }
      public_park: { Args: { park_slug: string }; Returns: Json }
      public_sitemap: {
        Args: never
        Returns: {
          kind: string
          metro_slug: string
          slug: string
          updated_at: string
        }[]
      }
      redeem_my_page_invite: { Args: never; Returns: string | null }
      reopen_page: { Args: { page: string }; Returns: string }
      resend_page_claim_code: {
        Args: { claim: string; language?: string }
        Returns: string
      }
      send_claim_invite: {
        Args: { email: string; language?: string; logo?: string; page: string }
        Returns: { code: string; invite_id: string }[]
      }
      send_page_claim: {
        Args: { claim: string; email_code?: string; posted_url?: string }
        Returns: string
      }
      set_page_inbox_push: {
        Args: { enabled: boolean; page: string }
        Returns: undefined
      }
      set_page_logo: { Args: { page: string; path: string }; Returns: undefined }
      page_team: {
        Args: { page: string }
        Returns: {
          avatar_path: string | null
          is_me: boolean
          joined_at: string
          role: string
          user_id: string
          username: string | null
        }[]
      }
      page_team_invites: {
        Args: { page: string }
        Returns: {
          avatar_path: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          kind: string
          role: string | null
          username: string | null
        }[]
      }
      set_page_member_role: {
        Args: { member: string; page: string; role: Database["public"]["Enums"]["page_member_role"] }
        Returns: undefined
      }
      remove_page_member: { Args: { member: string; page: string }; Returns: undefined }
      leave_page_team: { Args: { page: string }; Returns: undefined }
      offer_page_ownership: { Args: { member: string; page: string }; Returns: string }
      block_from_page: { Args: { page: string; who: string }; Returns: undefined }
      split_page: {
        Args: {
          city?: string
          country?: string
          handle: string
          line: string
          name: string
          page: string
          products?: string[]
          role: Database["public"]["Enums"]["page_role"]
        }
        Returns: string
      }
      spots_taken: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: number | null
      }
      suspend_page: {
        Args: {
          cancel_meetups?: boolean
          hide_recent?: boolean
          page: string
          reason: string
        }
        Returns: number
      }
      unblock_from_page: { Args: { page: string; who: string }; Returns: undefined }
      page_blocked_people: {
        Args: { page: string }
        Returns: {
          avatar_path: string | null
          blocked_at: string
          blocked_by_username: string | null
          user_id: string
          username: string | null
        }[]
      }
      update_page_details: {
        Args: { links: string[]; main_language: string; page: string }
        Returns: undefined
      }
      set_page_description: {
        Args: { body: string; locale: string; page: string }
        Returns: undefined
      }
      set_page_header: { Args: { page: string; path?: string }; Returns: undefined }
      set_page_location_type: {
        Args: {
          location_type: Database["public"]["Enums"]["shop_location_type"]
          page: string
          show_pin?: boolean
        }
        Returns: undefined
      }
      set_page_location: {
        Args: { address: string; latitude: number; longitude: number; page: string }
        Returns: undefined
      }
      set_page_hours: { Args: { hours: Json; page: string }; Returns: undefined }
      set_page_temp_closed: {
        Args: { closed: boolean; closed_until?: string; note?: string; page: string }
        Returns: undefined
      }
      set_page_brands_carried: { Args: { brands: string[]; page: string }; Returns: undefined }
      close_page_for_good: { Args: { page: string }; Returns: string }
      i_made_post: { Args: { post: string }; Returns: boolean }
      page_near_you_status: {
        Args: { page: string }
        Returns: { metro_name: string | null; reaches: boolean; used_today: boolean; week_left: number }[]
      }
      page_post_bylines: {
        Args: { page: string; posts: string[] }
        Returns: { post_id: string; username: string | null }[]
      }
      page_inbox: {
        Args: { max_rows?: number; page: string }
        Returns: {
          author_avatar_path: string | null
          author_id: string | null
          author_page: Json | null
          author_username: string | null
          body: string | null
          comment_id: string | null
          created_at: string
          event_comment_id: string | null
          event_id: string | null
          event_title: string | null
          id: string
          kind: string
          post_id: string | null
          unread: boolean
        }[]
      }
      mark_page_inbox_seen: { Args: { page: string }; Returns: undefined }
      start_page_claim: {
        Args: {
          email?: string
          language?: string
          note?: string
          page: string
          proof: Database["public"]["Enums"]["page_claim_proof"]
          role_title: string
        }
        Returns: {
          claim_id: string
          domain_matches: boolean | null
          posted_code: string | null
          posted_code_expires_at: string | null
        }[]
      }
      withdraw_page_claim: { Args: { claim: string }; Returns: undefined }
      admin_page_blocks: {
        Args: { lifted?: boolean; page?: string }
        Returns: {
          blocked_by: string | null
          blocked_by_role: string | null
          created_at: string
          flagged: boolean
          id: string
          lifted_at: string | null
          lifted_by: string | null
          page_city: string | null
          page_country: string | null
          page_handle: string
          page_id: string
          page_name: string
          page_roles: string[]
          skater: string | null
          week_count: number
        }[]
      }
      approve_page_suggestion: {
        Args: {
          address?: string
          city?: string
          country?: string
          handle: string
          latitude?: number
          line: string
          location_type?: Database["public"]["Enums"]["shop_location_type"]
          longitude?: number
          metro?: string
          name: string
          role: Database["public"]["Enums"]["page_role"]
          suggestion: string
          website?: string
        }
        Returns: string
      }
      catalog_export: {
        Args: { page: string }
        Returns: {
          disciplines: string
          edition: string | null
          entry_type: string
          family: string | null
          first_year: string | null
          includes_frame: string | null
          model: string
          notes: string | null
          partner: string | null
          part_type: string
          pro_rider: string | null
          product_id: string
          sources: string | null
          status: string
          stock_parts: string | null
        }[]
      }
      claim_review_detail: { Args: { claim: string }; Returns: Json }
      claimable_pages: {
        Args: { max_results?: number; q?: string }
        Returns: {
          city: string | null
          country: string | null
          display_name: string
          followers: number
          handle: string
          id: string
          roles: string[]
        }[]
      }
      file_page_fix: {
        Args: {
          field: Database["public"]["Enums"]["page_fix_field"]
          note?: string
          page: string
          value?: string
        }
        Returns: undefined
      }
      flagged_page_count: { Args: never; Returns: number }
      lift_page_block: { Args: { block: string }; Returns: undefined }
      page_block_detail: { Args: { block: string }; Returns: Json }
      page_fix_review_detail: { Args: { report: string }; Returns: Json }
      page_report_review_detail: { Args: { page: string }; Returns: Json }
      page_suggestion_review_detail: { Args: { suggestion: string }; Returns: Json }
      product_suggestion_review_detail: { Args: { suggestion: string }; Returns: Json }
      resolve_page_reports: { Args: { actioned: boolean; page: string }; Returns: undefined }
      review_page_fix: {
        Args: { action: string; report: string; value?: string }
        Returns: undefined
      }
      review_page_suggestion: {
        Args: { action: string; page?: string; suggestion: string }
        Returns: undefined
      }
      review_product_suggestion: {
        Args: { action: string; part_type?: string; suggestion: string; value?: string }
        Returns: string
      }
      set_claim_checked: { Args: { checked: boolean; claim: string }; Returns: undefined }
      set_page_translated: { Args: { page: string }; Returns: undefined }
      before_user_created: { Args: { event: Json }; Returns: Json }
      can_delete_meetup: { Args: { event: string }; Returns: boolean }
      can_hide_meetup: { Args: { event: string }; Returns: boolean }
      cancel_invite: { Args: { invite: string }; Returns: undefined }
      cancel_meetup: {
        Args: {
          event: string
          note?: string
          reason: Database["public"]["Enums"]["meetup_cancel_reason"]
          scope?: string
        }
        Returns: number
      }
      check_in: {
        Args: {
          audience?: Database["public"]["Enums"]["check_in_audience"]
          latitude: number
          longitude: number
          park: string
        }
        Returns: string
      }
      check_in_parks: {
        Args: { latitude: number; longitude: number }
        Returns: {
          display_name: string
          distance_m: number
          id: string
          slug: string
        }[]
      }
      check_out: { Args: never; Returns: undefined }
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
      create_meetup: {
        Args: {
          address?: string
          adults_only?: boolean
          as_page?: string
          capacity?: number
          co_hosts?: string[]
          cover_path?: string
          days?: Json
          disciplines?: Database["public"]["Enums"]["discipline"][]
          ends_at?: string
          latitude?: number
          longitude?: number
          more_parks?: string[]
          note?: string
          park?: string
          repeat_ends_on?: string
          seasons?: Json
          place?: Database["public"]["Enums"]["meetup_place"]
          starts_at?: string
          ticket_url?: string
          title?: string
          visibility?: Database["public"]["Enums"]["meetup_visibility"]
          weekdays?: number[]
          who_for?: string
        }
        Returns: string
      }
      delete_meetup: { Args: { event: string }; Returns: undefined }
      delete_meetup_comment: { Args: { comment: string }; Returns: undefined }
      delete_my_account: { Args: { keep_posts?: boolean }; Returns: undefined }
      event_going_list: {
        Args: { event: string }
        Returns: {
          avatar_path: string | null
          following: boolean
          going_privately: boolean
          role: string
          user_id: string
          username: string | null
        }[]
      }
      event_going_summary: {
        Args: { event: string }
        Returns: {
          i_am_going: boolean
          i_host: boolean
          my_going_privately: boolean
          my_remind_me: boolean
          total: number
          unnamed: number
        }[]
      }
      export_my_data: { Args: never; Returns: Json }
      feed_at: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
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
      feed_meetups: {
        Args: { max_results?: number; newer_than?: string; up_to?: string }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
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
      file_page_report: {
        Args: {
          details?: string
          page: string
          reason: Database["public"]["Enums"]["report_reason"]
        }
        Returns: undefined
      }
      file_report: {
        Args: {
          comment?: string
          details?: string
          impersonating?: string
          meetup?: string
          meetup_comment?: string
          person?: string
          post?: string
          reason?: Database["public"]["Enums"]["report_reason"]
        }
        Returns: undefined
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
      follow_meetup_series: {
        Args: { follow: boolean; series: string }
        Returns: undefined
      }
      going_faces: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      going_total: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: number
      }
      hide_meetup: {
        Args: { at_park?: string; event: string; hide?: boolean }
        Returns: undefined
      }
      host_list: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      i_am_going: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      invite_co_hosts: {
        Args: { people: string[]; series: string }
        Returns: number
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
      linked_post_count: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: number
      }
      mark_admin_page_seen: { Args: { page: string }; Returns: undefined }
      mark_notifications_seen: { Args: never; Returns: undefined }
      meetup_comment_count: {
        Args: { "": Database["public"]["Tables"]["events"]["Row"] }
        Returns: number
      }
      meetup_mention_people: {
        Args: { event: string; q?: string }
        Returns: {
          avatar_path: string
          id: string
          reason: string
          username: string
        }[]
      }
      meetup_comments: {
        Args: { event: string }
        Returns: {
          author_id: string | null
          author_role: string | null
          avatar_path: string | null
          body: string | null
          created_at: string
          deleted: boolean
          id: string
          page: Json | null
          parent_id: string | null
          reply_to_username: string | null
          username: string | null
        }[]
      }
      moderate_reports: {
        Args: {
          days?: number
          decision: string
          hide?: boolean
          message?: string
          target: string
          target_kind: string
        }
        Returns: undefined
      }
      moderation_queue: {
        Args: { metro?: string }
        Returns: {
          id: string
          kind: string
          label: string | null
          latest_at: string
          metro_area_id: string | null
          metro_name: string | null
          park_id: string | null
          park_name: string | null
          park_slug: string | null
          reason: string | null
          report_count: number
          state: string
          target: string
          username: string | null
          waiting_since: string
          page_id: string | null
          page_name: string | null
          page_handle: string | null
          page_roles: string[] | null
          page_place: string | null
          flag: boolean | null
        }[]
      }
      moderation_report_detail: {
        Args: { target: string; target_kind: string }
        Returns: Json
      }
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
      my_going_privately_default: { Args: never; Returns: boolean }
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
          detail: string | null
          event_id: string | null
          event_starts_at: string | null
          event_timezone: string | null
          event_title: string | null
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
      my_push_settings: {
        Args: never
        Returns: {
          comments: boolean
          filmer_credits: boolean
          invites: boolean
          meetups: boolean
          mentions: boolean
          pages_joining: boolean
          park_fixes: boolean
          someone_new: boolean
          tags: boolean
          teams_claims: boolean
        }[]
      }
      my_recent_meetups: {
        Args: { park: string }
        Returns: {
          ends_at: string
          event_id: string
          note: string | null
          starts_at: string
          title: string | null
        }[]
      }
      my_restriction: {
        Args: never
        Returns: {
          banned: boolean
          message: string | null
          suspended_until: string | null
        }[]
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
      obstacle_review_detail: { Args: { obstacle: string }; Returns: Json }
      page_follower_count: { Args: { page: string }; Returns: number }
      page_for_handle: { Args: { h: string }; Returns: string }
      page_viewer_state: {
        Args: { page: string }
        Returns: {
          blocked: boolean
          can_follow: boolean
          following: boolean
          muted: boolean
          team_role: Database["public"]["Enums"]["page_member_role"] | null
        }[]
      }
      park_here_now: {
        Args: { park: string }
        Returns: {
          avatar_path: string | null
          ends_at: string
          following: boolean
          user_id: string
          username: string | null
        }[]
      }
      park_here_now_unnamed: { Args: { park: string }; Returns: number }
      park_info_review_detail: { Args: { report: string }; Returns: Json }
      park_meetups: {
        Args: { max_results?: number; park: string }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      park_past_meetup_count: { Args: { park: string }; Returns: number }
      park_past_meetups: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          park: string
        }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
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
          page: Json | null
          reply_to_page_id: string | null
          can_delete: boolean
          by_my_page: boolean
        }[]
      }
      comment_as_pages: {
        Args: { post: string }
        Returns: {
          display_name: string
          handle: string
          logo_path: string | null
          page_id: string
          roles: string[]
          state: string
        }[]
      }
      profile_check_in: {
        Args: { person: string }
        Returns: {
          audience: Database["public"]["Enums"]["check_in_audience"] | null
          ends_at: string
          park_id: string
          park_name: string
          park_slug: string
        }[]
      }
      profile_meetups: {
        Args: { max_results?: number; person: string }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      profile_past_meetups: {
        Args: {
          before_at?: string
          before_id?: string
          max_results?: number
          person: string
        }
        Returns: {
          address: string | null
          adults_only: boolean
          cancel_note: string | null
          cancel_reason:
            | Database["public"]["Enums"]["meetup_cancel_reason"]
            | null
          cancelled_at: string | null
          capacity: number | null
          cover_path: string | null
          created_at: string
          disciplines: Database["public"]["Enums"]["discipline"][]
          ends_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metro_area_id: string | null
          multi_day: boolean
          note: string | null
          park_id: string | null
          place: Database["public"]["Enums"]["meetup_place"]
          series_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meetup_status"]
          ticket_url: string | null
          title: string | null
          updated_at: string
          went_count: number | null
          who_for: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      push_claim: {
        Args: { max_rows?: number }
        Returns: {
          actor_username: string | null
          comment_body: string | null
          detail: string | null
          devices: Json
          event_id: string | null
          event_starts_at: string | null
          event_timezone: string | null
          event_title: string | null
          kind: string
          metro_name: string | null
          outbox_id: number
          page_handle: string | null
          page_name: string | null
          park_name: string | null
          park_slug: string | null
          post_id: string | null
          send: boolean
        }[]
      }
      push_done: {
        Args: { dead_tokens?: string[]; outbox_ids: number[] }
        Returns: undefined
      }
      redeem_my_invite: { Args: never; Returns: string | null }
      register_push_device: {
        Args: { language: string; platform: string; token: string }
        Returns: undefined
      }
      remove_co_host: {
        Args: { person: string; series: string }
        Returns: undefined
      }
      remove_from_going: {
        Args: { event: string; person: string }
        Returns: undefined
      }
      remove_my_filmer_credit: { Args: { slide: string }; Returns: undefined }
      reorder_park_photos: {
        Args: { park: string; photo_ids: string[] }
        Returns: undefined
      }
      report_park_info: {
        Args: {
          field: Database["public"]["Enums"]["park_field"]
          note?: string
          obstacle?: string
          park: string
          photo_path?: string
          suggested?: Json
        }
        Returns: string
      }
      request_access: {
        Args: {
          disciplines?: Database["public"]["Enums"]["discipline"][]
          email: string
          home_city?: string
        }
        Returns: undefined
      }
      respond_co_host_invite: {
        Args: { accept: boolean; series: string }
        Returns: undefined
      }
      review_obstacle: {
        Args: {
          decision: string
          general_type?: Database["public"]["Enums"]["obstacle_type"]
          merge_into?: string
          name?: string
          obstacle: string
        }
        Returns: undefined
      }
      review_park_info: {
        Args: {
          approve: boolean
          mark_verified?: boolean
          report: string
          value?: Json
        }
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
      search_pages: {
        Args: { for_mention?: boolean; max_results?: number; q: string }
        Returns: {
          city: string | null
          country: string | null
          display_name: string
          following: boolean
          formerly: string | null
          handle: string
          id: string
          logo_path: string | null
          roles: Database["public"]["Enums"]["page_role"][]
          state: Database["public"]["Enums"]["page_state"]
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
      set_going: {
        Args: {
          confirmed_adult?: boolean
          event: string
          going: boolean
          going_privately?: boolean
          remind_me?: boolean
        }
        Returns: undefined
      }
      set_going_privately_default: {
        Args: { value: boolean }
        Returns: undefined
      }
      set_meetup_repeat: {
        Args: {
          repeat_ends_on?: string
          seasons?: Json
          series: string
          weekdays: number[]
        }
        Returns: number
      }
      set_park_verified: { Args: { park: string }; Returns: undefined }
      set_push_setting: {
        Args: { enabled: boolean; setting: string }
        Returns: undefined
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
      shops_in_bounds: {
        Args: { east: number; north: number; south: number; west: number }
        Returns: {
          address: string | null
          city: string | null
          country: string | null
          display_name: string
          handle: string
          hours: Json
          id: string
          latitude: number
          location_type: Database["public"]["Enums"]["shop_location_type"]
          logo_path: string | null
          longitude: number
          state: Database["public"]["Enums"]["page_state"]
          temp_closed_at: string | null
          temp_closed_until: string | null
          timezone: string | null
        }[]
      }
      suggest_product: {
        Args: {
          kind: Database["public"]["Enums"]["product_suggestion_kind"]
          note?: string
          page: string
          part_type?: string
          product?: string
          value?: string
        }
        Returns: string
      }
      suggest_page: {
        Args: {
          link?: string
          name: string
          role: Database["public"]["Enums"]["page_role"]
          what?: string
        }
        Returns: string
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
      unregister_push_device: { Args: { token: string }; Returns: undefined }
      update_meetup: {
        Args: { changes: Json; event: string; scope: string }
        Returns: number
      }
      username_available: { Args: { name: string }; Returns: boolean }
      welcome_metro_areas: { Args: never; Returns: { name: string }[] }
    }
    Enums: {
      announcement_kind: "joined" | "visiting"
      check_in_audience: "followers" | "friends"
      discipline: "inline" | "quad" | "skateboard" | "bmx" | "scooter"
      follow_status: "pending" | "accepted"
      media_kind: "photo" | "video"
      meetup_cancel_reason:
        | "rained_out"
        | "park_closed"
        | "something_came_up"
        | "other"
        | "page_closed"
        | "page_suspended"
      meetup_host_role: "host" | "co_host"
      meetup_place: "park" | "page" | "address"
      meetup_status: "scheduled" | "cancelled"
      meetup_visibility: "public" | "followers"
      notification_kind:
        | "comment"
        | "tag"
        | "filmer_credit"
        | "invite_used"
        | "park_report_accepted"
        | "role_invite"
        | "post_removed"
        | "comment_removed"
        | "warning"
        | "suspension"
        | "role_vacated"
        | "caption_mention"
        | "meetup_changed"
        | "meetup_cancelled"
        | "meetup_reminder"
        | "meetup_going"
        | "co_host_invite"
        | "meetup_comment"
        | "meetup_hidden"
        | "page_invite"
        | "page_claim_approved"
        | "page_claim_declined"
        | "page_team_change"
        | "page_claimed"
        | "suggestion_live"
        | "page_mention"
        | "page_comment"
        | "page_split"
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
      page_claim_proof: "email" | "posted_code"
      page_claim_status: "draft" | "pending" | "approved" | "declined" | "withdrawn"
      page_fix_field:
        | "hours"
        | "location_type"
        | "location"
        | "brands_carried"
        | "website"
        | "closed"
        | "other"
      page_invite_kind: "team" | "ownership" | "claim"
      page_member_role: "staff" | "manager" | "owner"
      page_role: "brand" | "shop" | "organizer"
      product_entry_type: "model" | "pro" | "collab" | "special_edition"
      product_status: "current" | "discontinued" | "unknown"
      product_suggestion_kind:
        | "missing_model"
        | "wrong_name"
        | "wrong_year"
        | "no_longer_made"
        | "stock_parts"
        | "something_else"
      page_state:
        | "unofficial"
        | "name_only"
        | "managed"
        | "out_of_business"
        | "closed"
        | "inactive"
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
      park_setting: "indoor" | "outdoor" | "indoor_outdoor" | "covered_outdoor"
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
        | "wrong_park"
        | "impersonation"
        | "our_page"
        | "wrong_info"
      report_status: "open" | "dismissed" | "actioned" | "escalated"
      review_status: "open" | "accepted" | "rejected"
      role_name: "owner" | "city_admin" | "park_admin" | "park_contributor"
      shop_location_type: "storefront" | "by_appointment" | "online_only"
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
      check_in_audience: ["followers", "friends"],
      discipline: ["inline", "quad", "skateboard", "bmx", "scooter"],
      follow_status: ["pending", "accepted"],
      media_kind: ["photo", "video"],
      meetup_cancel_reason: [
        "rained_out",
        "park_closed",
        "something_came_up",
        "other",
        "page_closed",
        "page_suspended",
      ],
      meetup_host_role: ["host", "co_host"],
      meetup_place: ["park", "page", "address"],
      meetup_status: ["scheduled", "cancelled"],
      meetup_visibility: ["public", "followers"],
      notification_kind: [
        "comment",
        "tag",
        "filmer_credit",
        "invite_used",
        "park_report_accepted",
        "role_invite",
        "post_removed",
        "comment_removed",
        "warning",
        "suspension",
        "role_vacated",
        "caption_mention",
        "meetup_changed",
        "meetup_cancelled",
        "meetup_reminder",
        "meetup_going",
        "co_host_invite",
        "meetup_comment",
        "meetup_hidden",
        "page_invite",
        "page_claim_approved",
        "page_claim_declined",
        "page_team_change",
        "page_claimed",
        "suggestion_live",
        "page_mention",
        "page_comment",
        "page_split",
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
      page_claim_proof: ["email", "posted_code"],
      page_claim_status: ["draft", "pending", "approved", "declined", "withdrawn"],
      page_fix_field: [
        "hours",
        "location_type",
        "location",
        "brands_carried",
        "website",
        "closed",
        "other",
      ],
      page_invite_kind: ["team", "ownership", "claim"],
      page_member_role: ["staff", "manager", "owner"],
      page_role: ["brand", "shop", "organizer"],
      product_entry_type: ["model", "pro", "collab", "special_edition"],
      product_status: ["current", "discontinued", "unknown"],
      product_suggestion_kind: [
        "missing_model",
        "wrong_name",
        "wrong_year",
        "no_longer_made",
        "stock_parts",
        "something_else",
      ],
      page_state: [
        "unofficial",
        "name_only",
        "managed",
        "out_of_business",
        "closed",
        "inactive",
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
      park_setting: ["indoor", "outdoor", "indoor_outdoor", "covered_outdoor"],
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
        "wrong_park",
        "impersonation",
        "our_page",
        "wrong_info",
      ],
      report_status: ["open", "dismissed", "actioned", "escalated"],
      review_status: ["open", "accepted", "rejected"],
      role_name: ["owner", "city_admin", "park_admin", "park_contributor"],
      shop_location_type: ["storefront", "by_appointment", "online_only"],
      text_source: ["author", "machine"],
      time_anchor: ["clock", "sunrise", "sunset"],
      upload_status: ["uploading", "processing", "ready", "failed"],
    },
  },
} as const
