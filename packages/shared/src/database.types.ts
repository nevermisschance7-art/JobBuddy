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
      ai_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          last_error: string | null
          provider: string
          quota_reset_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          last_error?: string | null
          provider: string
          quota_reset_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          last_error?: string | null
          provider?: string
          quota_reset_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      answer_memory: {
        Row: {
          created_at: string
          final_answer: string
          id: string
          job_id: string | null
          question_embedding: string | null
          question_text: string
          times_reused: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          final_answer: string
          id?: string
          job_id?: string | null
          question_embedding?: string | null
          question_text: string
          times_reused?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          final_answer?: string
          id?: string
          job_id?: string | null
          question_embedding?: string | null
          question_text?: string
          times_reused?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_memory_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          answers: Json
          applied_at: string | null
          created_at: string
          id: string
          job_id: string
          last_reply_at: string | null
          notes: string | null
          status: string
          tailored_cv_docx: string | null
          tailored_cv_pdf: string | null
          tailored_resume_json: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          applied_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          last_reply_at?: string | null
          notes?: string | null
          status?: string
          tailored_cv_docx?: string | null
          tailored_cv_pdf?: string | null
          tailored_resume_json?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          applied_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          last_reply_at?: string | null
          notes?: string | null
          status?: string
          tailored_cv_docx?: string | null
          tailored_cv_pdf?: string | null
          tailored_resume_json?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          ats: string
          checked_at: string | null
          created_at: string
          discovered_via: string
          fail_count: number
          id: string
          jobs_open: number
          last_error: string | null
          last_ok_at: string | null
          name: string
          slug: string
          updated_at: string
          website: string | null
        }
        Insert: {
          active?: boolean
          ats: string
          checked_at?: string | null
          created_at?: string
          discovered_via?: string
          fail_count?: number
          id?: string
          jobs_open?: number
          last_error?: string | null
          last_ok_at?: string | null
          name: string
          slug: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          active?: boolean
          ats?: string
          checked_at?: string | null
          created_at?: string
          discovered_via?: string
          fail_count?: number
          id?: string
          jobs_open?: number
          last_error?: string | null
          last_ok_at?: string | null
          name?: string
          slug?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      cvs: {
        Row: {
          confirmed: boolean
          created_at: string
          embedding: string | null
          id: string
          original_file: string | null
          resume_json: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          embedding?: string | null
          id?: string
          original_file?: string | null
          resume_json?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          embedding?: string | null
          id?: string
          original_file?: string | null
          resume_json?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employer_messages: {
        Row: {
          application_id: string | null
          classification: string | null
          confidence: number | null
          created_at: string
          from_domain: string
          id: string
          received_at: string
          snippet: string | null
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          classification?: string | null
          confidence?: number | null
          created_at?: string
          from_domain: string
          id?: string
          received_at: string
          snippet?: string | null
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          classification?: string | null
          confidence?: number | null
          created_at?: string
          from_domain?: string
          id?: string
          received_at?: string
          snippet?: string | null
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          payload: Json
          read: boolean
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          read?: boolean
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          read?: boolean
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      filters: {
        Row: {
          countries_allowed: string[]
          created_at: string
          employment_types: string[]
          excluded_companies: string[]
          excluded_skills: string[]
          home_location: string | null
          hybrid_max_office_days: number | null
          max_commute_km: number | null
          must_have_skills: string[]
          needs_sponsorship: boolean
          remote_extra_countries: string[]
          remote_types: string[]
          salary_currency: string | null
          salary_floor: number | null
          seniority_levels: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          countries_allowed?: string[]
          created_at?: string
          employment_types?: string[]
          excluded_companies?: string[]
          excluded_skills?: string[]
          home_location?: string | null
          hybrid_max_office_days?: number | null
          max_commute_km?: number | null
          must_have_skills?: string[]
          needs_sponsorship?: boolean
          remote_extra_countries?: string[]
          remote_types?: string[]
          salary_currency?: string | null
          salary_floor?: number | null
          seniority_levels?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          countries_allowed?: string[]
          created_at?: string
          employment_types?: string[]
          excluded_companies?: string[]
          excluded_skills?: string[]
          home_location?: string | null
          hybrid_max_office_days?: number | null
          max_commute_km?: number | null
          must_have_skills?: string[]
          needs_sponsorship?: boolean
          remote_extra_countries?: string[]
          remote_types?: string[]
          salary_currency?: string | null
          salary_floor?: number | null
          seniority_levels?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fixed_answers: {
        Row: {
          applies_to_country: string | null
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          applies_to_country?: string | null
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          applies_to_country?: string | null
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          apply_url: string
          canonical_url: string
          closed_at: string | null
          company_id: string | null
          company_name: string
          content_hash: string | null
          content_updated_at: string
          countries: string[]
          created_at: string
          date_source: string
          dedupe_key: string | null
          description_text: string
          embedding: string | null
          employment_type: string
          external_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          locations: Json
          missed_runs: number
          posted_at: string | null
          remote_regions: string[]
          remote_type: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          seniority: string
          source: string
          source_updated_at: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          apply_url: string
          canonical_url: string
          closed_at?: string | null
          company_id?: string | null
          company_name: string
          content_hash?: string | null
          content_updated_at?: string
          countries?: string[]
          created_at?: string
          date_source?: string
          dedupe_key?: string | null
          description_text?: string
          embedding?: string | null
          employment_type?: string
          external_id: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          locations?: Json
          missed_runs?: number
          posted_at?: string | null
          remote_regions?: string[]
          remote_type?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          seniority?: string
          source: string
          source_updated_at?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          apply_url?: string
          canonical_url?: string
          closed_at?: string | null
          company_id?: string | null
          company_name?: string
          content_hash?: string | null
          content_updated_at?: string
          countries?: string[]
          created_at?: string
          date_source?: string
          dedupe_key?: string | null
          description_text?: string
          embedding?: string | null
          employment_type?: string
          external_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          locations?: Json
          missed_runs?: number
          posted_at?: string | null
          remote_regions?: string[]
          remote_type?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          seniority?: string
          source?: string
          source_updated_at?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          created_at: string
          error_kind: string | null
          error_message: string | null
          id: string
          input_tokens: number | null
          latency_ms: number
          model: string
          ok: boolean
          output_tokens: number | null
          provider: string
          task: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_kind?: string | null
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms: number
          model: string
          ok: boolean
          output_tokens?: number | null
          provider: string
          task: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_kind?: string | null
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number
          model?: string
          ok?: boolean
          output_tokens?: number | null
          provider?: string
          task?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          alert_settings: Json
          created_at: string
          display_name: string | null
          matched_at: string | null
          min_score: number
          onboarded_at: string | null
          time_zone: string
          tone: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          alert_settings?: Json
          created_at?: string
          display_name?: string | null
          matched_at?: string | null
          min_score?: number
          onboarded_at?: string | null
          time_zone?: string
          tone?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          alert_settings?: Json
          created_at?: string
          display_name?: string | null
          matched_at?: string | null
          min_score?: number
          onboarded_at?: string | null
          time_zone?: string
          tone?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      source_runs: {
        Row: {
          created_at: string
          errors: Json
          finished_at: string | null
          id: string
          jobs_closed: number
          jobs_new: number
          jobs_seen: number
          jobs_updated: number
          source: string
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          errors?: Json
          finished_at?: string | null
          id?: string
          jobs_closed?: number
          jobs_new?: number
          jobs_seen?: number
          jobs_updated?: number
          source: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          errors?: Json
          finished_at?: string | null
          id?: string
          jobs_closed?: number
          jobs_new?: number
          jobs_seen?: number
          jobs_updated?: number
          source?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_job_matches: {
        Row: {
          breakdown: Json
          created_at: string
          dismissed_reason: string | null
          explained_at: string | null
          explanation: string | null
          id: string
          job_id: string
          passed_filters: boolean
          reasons_failed: string[]
          score: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          breakdown?: Json
          created_at?: string
          dismissed_reason?: string | null
          explained_at?: string | null
          explanation?: string | null
          id?: string
          job_id: string
          passed_filters: boolean
          reasons_failed?: string[]
          score: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          breakdown?: Json
          created_at?: string
          dismissed_reason?: string | null
          explained_at?: string | null
          explanation?: string | null
          id?: string
          job_id?: string
          passed_filters?: boolean
          reasons_failed?: string[]
          score?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_job_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      company_stats: {
        Row: {
          active: number | null
          ats: string | null
          inactive: number | null
          jobs_open: number | null
          last_added_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      close_stale_jobs: {
        Args: { p_days: number; p_source: string }
        Returns: number
      }
      jobs_for_matching: {
        Args: {
          p_cv: string
          p_limit: number
          p_offset: number
          p_since: string
        }
        Returns: {
          company_name: string
          countries: string[]
          description_text: string
          employment_type: string
          id: string
          posted_at: string
          remote_regions: string[]
          remote_type: string
          salary_currency: string
          salary_max: number
          salary_min: number
          seniority: string
          similarity: number
          tags: string[]
          title: string
        }[]
      }
      mark_jobs_missed: { Args: { ids: string[] }; Returns: number }
      mark_jobs_seen: { Args: { ids: string[] }; Returns: undefined }
      prune_closed_jobs: { Args: never; Returns: number }
      prune_stale_jobs: { Args: never; Returns: number }
      record_company_results: { Args: { results: Json }; Returns: undefined }
      start_fetch_run: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
