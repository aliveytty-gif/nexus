// Schema contract through 202610130002_dating.sql.
// Regenerate from your Supabase project after changing migrations (see README).
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      dating_profiles: {
        Row: { user_id: string; enabled: boolean; bio: string; age: number | null; photo_paths: string[]; created_at: string; updated_at: string };
        Insert: { user_id: string; enabled?: boolean; bio?: string; age?: number | null; photo_paths?: string[]; created_at?: string; updated_at?: string };
        Update: { enabled?: boolean; bio?: string; age?: number | null; photo_paths?: string[] };
        Relationships: [{ foreignKeyName: "dating_profiles_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] }];
      };
      dating_reactions: {
        Row: { user_id: string; target_user_id: string; reaction: "liked" | "skipped"; created_at: string };
        Insert: { user_id: string; target_user_id: string; reaction: "liked" | "skipped"; created_at?: string };
        Update: { reaction?: "liked" | "skipped" };
        Relationships: [
          { foreignKeyName: "dating_reactions_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dating_reactions_target_user_id_fkey"; columns: ["target_user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      dating_matches: {
        Row: { id: string; user_a: string; user_b: string; created_at: string };
        Insert: { id?: string; user_a: string; user_b: string; created_at?: string };
        Update: Record<string, never>;
        Relationships: [
          { foreignKeyName: "dating_matches_user_a_fkey"; columns: ["user_a"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dating_matches_user_b_fkey"; columns: ["user_b"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      user_blocks: {
        Row: { blocker_id: string; blocked_id: string; created_at: string };
        Insert: { blocker_id: string; blocked_id: string; created_at?: string };
        Update: Record<string, never>;
        Relationships: [
          { foreignKeyName: "user_blocks_blocker_id_fkey"; columns: ["blocker_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "user_blocks_blocked_id_fkey"; columns: ["blocked_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      dating_reports: {
        Row: { id: string; reporter_id: string; reported_id: string; reason: string; created_at: string };
        Insert: { id?: string; reporter_id: string; reported_id: string; reason: string; created_at?: string };
        Update: Record<string, never>;
        Relationships: [
          { foreignKeyName: "dating_reports_reporter_id_fkey"; columns: ["reporter_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "dating_reports_reported_id_fkey"; columns: ["reported_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      audio_tracks: {
        Row: { id: string; owner_id: string; title: string; artist: string; file_path: string; duration: number | null; created_at: string };
        Insert: { id?: string; owner_id: string; title: string; artist?: string; file_path: string; duration?: number | null; created_at?: string };
        Update: { title?: string; artist?: string };
        Relationships: [{
          foreignKeyName: "audio_tracks_owner_id_fkey"; columns: ["owner_id"]; isOneToOne: false;
          referencedRelation: "profiles"; referencedColumns: ["id"];
        }];
      };
      playlists: {
        Row: { id: string; owner_id: string; name: string; created_at: string };
        Insert: { id?: string; owner_id: string; name: string; created_at?: string };
        Update: { name?: string };
        Relationships: [{
          foreignKeyName: "playlists_owner_id_fkey"; columns: ["owner_id"]; isOneToOne: false;
          referencedRelation: "profiles"; referencedColumns: ["id"];
        }];
      };
      playlist_tracks: {
        Row: { playlist_id: string; track_id: string; position: number; added_at: string };
        Insert: { playlist_id: string; track_id: string; position?: number; added_at?: string };
        Update: { position?: number };
        Relationships: [
          { foreignKeyName: "playlist_tracks_playlist_id_fkey"; columns: ["playlist_id"]; isOneToOne: false; referencedRelation: "playlists"; referencedColumns: ["id"] },
          { foreignKeyName: "playlist_tracks_track_id_fkey"; columns: ["track_id"]; isOneToOne: false; referencedRelation: "audio_tracks"; referencedColumns: ["id"] },
        ];
      };
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url: string | null;
          bio: string;
          specialty: string;
          course: number | null;
          group_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          first_name?: string;
          last_name?: string;
          username: string;
          avatar_url?: string | null;
          bio?: string;
          specialty?: string;
          course?: number | null;
          group_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          username?: string;
          avatar_url?: string | null;
          bio?: string;
          specialty?: string;
          course?: number | null;
          group_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          author_id: string;
          content: string;
          image_url: string | null;
          attachments: Json;
          community_id: string | null;
          is_repost: boolean;
          original_post_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          content: string;
          image_url?: string | null;
          attachments?: Json;
          community_id?: string | null;
          is_repost?: boolean;
          original_post_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string;
          content?: string;
          image_url?: string | null;
          attachments?: Json;
          community_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_original_post_id_fkey";
            columns: ["original_post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      post_likes: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string; created_at?: string };
        Update: { post_id?: string; user_id?: string; created_at?: string };
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      communities: {
        Row: {
          id: string;
          name: string;
          description: string;
          avatar_url: string | null;
          type: "group" | "channel";
          owner_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          avatar_url?: string | null;
          type: "group" | "channel";
          owner_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string;
          avatar_url?: string | null;
          type?: "group" | "channel";
          owner_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communities_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      community_members: {
        Row: {
          community_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          joined_at: string;
        };
        Insert: {
          community_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member";
          joined_at?: string;
        };
        Update: {
          community_id?: string;
          user_id?: string;
          role?: "owner" | "admin" | "member";
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: "pending" | "accepted";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          requester_id: string;
          addressee_id: string;
          status?: "pending" | "accepted";
        };
        Update: { status?: "pending" | "accepted" };
        Relationships: [
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: { id: string; direct_key: string | null; kind: "direct" | "group"; title: string | null; avatar_path: string | null; created_at: string };
        Insert: { id?: string; direct_key?: string | null; kind?: "direct" | "group"; title?: string | null; avatar_path?: string | null; created_at?: string };
        Update: { id?: string; direct_key?: string | null; kind?: "direct" | "group"; title?: string | null; avatar_path?: string | null; created_at?: string };
        Relationships: [];
      };
      conversation_members: {
        Row: { conversation_id: string; user_id: string; role: "creator" | "admin" | "member"; joined_at: string; last_read_at: string };
        Insert: { conversation_id: string; user_id: string; role?: "creator" | "admin" | "member"; joined_at?: string; last_read_at?: string };
        Update: { conversation_id?: string; user_id?: string; role?: "creator" | "admin" | "member"; joined_at?: string; last_read_at?: string };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path: string | null;
          attachment_name: string | null;
          attachment_type: string | null;
          attachment_size: number | null;
          attachments: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path?: string | null;
          attachment_name?: string | null;
          attachment_type?: string | null;
          attachment_size?: number | null;
          attachments?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          body?: string;
          attachment_path?: string | null;
          attachment_name?: string | null;
          attachment_type?: string | null;
          attachment_size?: number | null;
          attachments?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          post_id: string;
          author_id: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          author_id: string;
          content: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          author_id?: string;
          content?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      interests: {
        Row: { id: string; slug: string; name: string };
        Insert: { id?: string; slug: string; name: string };
        Update: { id?: string; slug?: string; name?: string };
        Relationships: [];
      };
      profile_interests: {
        Row: { profile_id: string; interest_id: string };
        Insert: { profile_id: string; interest_id: string };
        Update: { profile_id?: string; interest_id?: string };
        Relationships: [
          {
            foreignKeyName: "profile_interests_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_interests_interest_id_fkey";
            columns: ["interest_id"];
            isOneToOne: false;
            referencedRelation: "interests";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      save_dating_profile: {
        Args: { p_enabled: boolean; p_bio: string; p_age: number | null; p_photo_paths: string[] };
        Returns: undefined;
      };
      get_dating_candidates: {
        Args: { p_min_age?: number | null; p_max_age?: number | null; p_course?: number | null; p_specialty?: string | null; p_interest_id?: string | null; p_limit?: number };
        Returns: { user_id: string; first_name: string; last_name: string; username: string; specialty: string; course: number | null; bio: string; age: number | null; photo_paths: string[]; interests: Json; score: number }[];
      };
      react_to_dating_profile: {
        Args: { p_target_user_id: string; p_reaction: "liked" | "skipped" };
        Returns: string | null;
      };
      set_user_block: { Args: { p_user_id: string; p_blocked: boolean }; Returns: undefined };
      report_dating_profile: { Args: { p_user_id: string; p_reason: string }; Returns: undefined };
      is_user_blocked: { Args: { p_user_id: string }; Returns: boolean };
      get_blocked_user_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      can_view_dating_profile: { Args: { p_user_id: string }; Returns: boolean };
      is_own_dating_photo: { Args: { p_path: string }; Returns: boolean };
      create_repost: {
        Args: { p_original_post_id: string; p_comment?: string };
        Returns: string;
      };
      get_repost_summaries: {
        Args: { p_post_ids: string[] };
        Returns: { post_id: string; repost_count: number; my_repost_id: string | null }[];
      };
      create_group_conversation: {
        Args: { p_title: string; p_member_ids: string[] };
        Returns: string;
      };
      update_group_conversation: {
        Args: { p_conversation_id: string; p_title: string; p_avatar_path: string | null };
        Returns: undefined;
      };
      manage_group_member: {
        Args: { p_conversation_id: string; p_user_id: string; p_action: "add" | "remove" | "promote" | "demote" };
        Returns: undefined;
      };
      leave_group_conversation: {
        Args: { p_conversation_id: string };
        Returns: undefined;
      };
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_message_id: string };
        Returns: undefined;
      };
      get_conversation_summaries: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string; kind: "direct" | "group"; title: string | null; avatar_path: string | null;
          created_at: string; role: "creator" | "admin" | "member"; last_read_at: string;
          other_id: string | null; other_username: string | null; other_first_name: string | null;
          other_last_name: string | null; other_avatar_url: string | null;
          last_message_id: string | null; last_body: string | null; last_attachment_name: string | null;
          last_message_at: string | null; last_sender_id: string | null; unread: boolean;
        }[];
      };
      create_community: {
        Args: { p_name: string; p_description: string; p_type: "group" | "channel"; p_avatar_url: string | null };
        Returns: string;
      };
      can_publish_to_community: {
        Args: { p_community_id: string };
        Returns: boolean;
      };
      can_access_message_file: {
        Args: { p_path: string; p_own: boolean };
        Returns: boolean;
      };
      get_or_create_direct_conversation: {
        Args: { p_other_user_id: string };
        Returns: string;
      };
      is_conversation_member: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
      update_my_profile: {
        Args: {
          p_first_name: string;
          p_last_name: string;
          p_username: string;
          p_avatar_url: string | null;
          p_bio: string;
          p_specialty: string;
          p_course: number | null;
          p_group_name: string;
          p_interest_ids: string[];
        };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Post = Database["public"]["Tables"]["posts"]["Row"];
export type PostLike = Database["public"]["Tables"]["post_likes"]["Row"];
export type Community = Database["public"]["Tables"]["communities"]["Row"];
export type CommunityMember = Database["public"]["Tables"]["community_members"]["Row"];
export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type Comment = Database["public"]["Tables"]["comments"]["Row"];
export type Interest = Database["public"]["Tables"]["interests"]["Row"];
