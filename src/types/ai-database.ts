import type { Json } from "./database";

export type AiThread = { id: string; user_id: string; title: string; summary: string; summary_through: string | null; created_at: string; updated_at: string };
export type AiTurn = {
  id: string; thread_id: string; user_id: string; question: string; answer: string;
  mode: "auto" | "quick" | "research" | "solve"; status: "running" | "complete" | "failed" | "cancelled";
  run_id: string; lease_expires_at: string; steps: number; sources: Json; actions: Json; usage: Json;
  error_code: string | null; created_at: string; updated_at: string;
};
export type AiPreferences = { user_id: string; enabled: boolean; content: string; consent_at: string | null; updated_at: string };
export type AiTables = {
  ai_threads: { Row: AiThread; Insert: never; Update: never; Relationships: [] };
  ai_turns: { Row: AiTurn; Insert: never; Update: never; Relationships: [] };
  ai_preferences: { Row: AiPreferences; Insert: AiPreferences; Update: Partial<AiPreferences>; Relationships: [] };
};
export type AiFunctions = {
  begin_ai_turn: { Args: { p_thread_id: string; p_turn_id: string; p_run_id: string; p_question: string; p_mode: string }; Returns: Json };
  reserve_ai_agent_step: { Args: { p_turn_id: string; p_run_id: string; p_user_limit: number; p_global_limit: number; p_min_remaining?: number }; Returns: Json };
  finish_ai_turn: { Args: { p_turn_id: string; p_run_id: string; p_status: string; p_answer: string; p_sources: Json; p_actions: Json; p_usage: Json; p_error_code?: string; p_summary?: string; p_summary_through?: string }; Returns: boolean };
};
