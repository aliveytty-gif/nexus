// Schema contract through 202609230001_closed_alpha.sql.
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          content: string;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string;
          content?: string;
          image_url?: string | null;
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
        ];
      };
      conversations: {
        Row: { id: string; direct_key: string; created_at: string };
        Insert: { id?: string; direct_key: string; created_at?: string };
        Update: { id?: string; direct_key?: string; created_at?: string };
        Relationships: [];
      };
      conversation_members: {
        Row: { conversation_id: string; user_id: string };
        Insert: { conversation_id: string; user_id: string };
        Update: { conversation_id?: string; user_id?: string };
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
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          body?: string;
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
export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type Comment = Database["public"]["Tables"]["comments"]["Row"];
export type Interest = Database["public"]["Tables"]["interests"]["Row"];
