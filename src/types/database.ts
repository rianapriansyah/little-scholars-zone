// GENERATED FILE — do not edit by hand.
// Regenerate with the Supabase MCP `generate_typescript_types` tool (project ref
// vocivoavwohhfhbdgkia) after every migration, then run `npm run build`.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      child_attendances: {
        Row: {
          attendance_date: string
          child_id: string
          classroom_id: string
          id: string
          learning_period_id: string
          note: string | null
          recorded_at: string
          recorded_by: string | null
          status: string
        }
        Insert: {
          attendance_date: string
          child_id: string
          classroom_id: string
          id?: string
          learning_period_id: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          status: string
        }
        Update: {
          attendance_date?: string
          child_id?: string
          classroom_id?: string
          id?: string
          learning_period_id?: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_attendances_period_fkey"
            columns: ["learning_period_id", "child_id", "classroom_id"]
            isOneToOne: false
            referencedRelation: "learning_period_status"
            referencedColumns: ["id", "child_id", "classroom_id"]
          },
          {
            foreignKeyName: "child_attendances_period_fkey"
            columns: ["learning_period_id", "child_id", "classroom_id"]
            isOneToOne: false
            referencedRelation: "learning_periods"
            referencedColumns: ["id", "child_id", "classroom_id"]
          },
        ]
      }
      children: {
        Row: {
          active: boolean
          birth_place: string | null
          birthdate: string | null
          created_at: string | null
          family_id: string
          full_name: string
          id: string
          notes: string | null
          photo_url: string | null
        }
        Insert: {
          active?: boolean
          birth_place?: string | null
          birthdate?: string | null
          created_at?: string | null
          family_id: string
          full_name: string
          id?: string
          notes?: string | null
          photo_url?: string | null
        }
        Update: {
          active?: boolean
          birth_place?: string | null
          birthdate?: string | null
          created_at?: string | null
          family_id?: string
          full_name?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "children_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      children_classrooms: {
        Row: {
          child_id: string
          classroom_teacher_id: string
          created_at: string | null
          created_by: string | null
          end_reason: string | null
          ended_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          child_id: string
          classroom_teacher_id: string
          created_at?: string | null
          created_by?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Update: {
          child_id?: string
          classroom_teacher_id?: string
          created_at?: string | null
          created_by?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "children_classrooms_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "children_classrooms_classroom_teacher_id_fkey"
            columns: ["classroom_teacher_id"]
            isOneToOne: false
            referencedRelation: "classroom_teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_teachers: {
        Row: {
          classroom_id: string
          created_at: string | null
          id: string
          teacher_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          id?: string
          teacher_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_teachers_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      classrooms: {
        Row: {
          active: boolean
          created_at: string | null
          id: string
          label: string
          time_end: string
          time_start: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          id?: string
          label: string
          time_end: string
          time_start: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          id?: string
          label?: string
          time_end?: string
          time_start?: string
        }
        Relationships: []
      }
      curriculum_items: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          label: string
          sort_order: number
          subject: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          subject: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          subject?: string
        }
        Relationships: []
      }
      daily_report_items: {
        Row: {
          created_at: string | null
          curriculum_item_id: string
          mastery_level: number
          report_id: string
        }
        Insert: {
          created_at?: string | null
          curriculum_item_id: string
          mastery_level: number
          report_id: string
        }
        Update: {
          created_at?: string | null
          curriculum_item_id?: string
          mastery_level?: number
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_items_curriculum_item_id_fkey"
            columns: ["curriculum_item_id"]
            isOneToOne: false
            referencedRelation: "curriculum_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          child_id: string
          classroom_teacher_id: string
          created_at: string | null
          created_by: string | null
          id: string
          report_date: string
          session_id: string | null
          submitted_at: string | null
        }
        Insert: {
          child_id: string
          classroom_teacher_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          report_date?: string
          session_id?: string | null
          submitted_at?: string | null
        }
        Update: {
          child_id?: string
          classroom_teacher_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          report_date?: string
          session_id?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_classroom_teacher_id_fkey"
            columns: ["classroom_teacher_id"]
            isOneToOne: false
            referencedRelation: "classroom_teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          address: string | null
          auth_user_id: string | null
          contact_email: string
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          father_name: string | null
          father_occupation: string | null
          father_phone: string | null
          id: string
          mother_name: string | null
          mother_occupation: string | null
          mother_phone: string | null
          name: string
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          contact_email: string
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          father_name?: string | null
          father_occupation?: string | null
          father_phone?: string | null
          id?: string
          mother_name?: string | null
          mother_occupation?: string | null
          mother_phone?: string | null
          name: string
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          contact_email?: string
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          father_name?: string | null
          father_occupation?: string | null
          father_phone?: string | null
          id?: string
          mother_name?: string | null
          mother_occupation?: string | null
          mother_phone?: string | null
          name?: string
        }
        Relationships: []
      }
      learning_periods: {
        Row: {
          actual_end_date: string | null
          child_id: string
          classroom_id: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          guaranteed_days: number
          id: string
          period_no: number
          projected_end_date: string | null
          start_date: string
        }
        Insert: {
          actual_end_date?: string | null
          child_id: string
          classroom_id: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          guaranteed_days?: number
          id?: string
          period_no: number
          projected_end_date?: string | null
          start_date: string
        }
        Update: {
          actual_end_date?: string | null
          child_id?: string
          classroom_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          guaranteed_days?: number
          id?: string
          period_no?: number
          projected_end_date?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_periods_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_periods_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          active: boolean
          auth_user_id: string | null
          call_name: string | null
          contact_phone: string | null
          created_at: string | null
          education: string | null
          email: string
          end_working_at: string | null
          full_name: string
          id: string
          photo_url: string | null
          start_working_at: string
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          call_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          education?: string | null
          email: string
          end_working_at?: string | null
          full_name: string
          id?: string
          photo_url?: string | null
          start_working_at?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          call_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          education?: string | null
          email?: string
          end_working_at?: string | null
          full_name?: string
          id?: string
          photo_url?: string | null
          start_working_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      learning_period_status: {
        Row: {
          actual_end_date: string | null
          child_id: string | null
          classroom_id: string | null
          closed_at: string | null
          created_at: string | null
          created_by: string | null
          days_consumed: number | null
          days_remaining: number | null
          days_sick: number | null
          guaranteed_days: number | null
          id: string | null
          is_active: boolean | null
          period_no: number | null
          projected_end_date: string | null
          start_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_periods_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_periods_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_record_attendance: {
        Args: { p_classroom_id: string }
        Returns: boolean
      }
      can_write_daily_report: {
        Args: { p_classroom_teacher_id: string }
        Returns: boolean
      }
      enroll_child_in_classroom: {
        Args: { p_child_id: string; p_classroom_teacher_id: string }
        Returns: undefined
      }
      family_active_classroom_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      family_active_classroom_teacher_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      family_children_ids: { Args: { p_auth_uid: string }; Returns: string[] }
      family_submitted_daily_report_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      record_attendance: {
        Args: {
          p_child_id: string
          p_classroom_id: string
          p_date: string
          p_note?: string
          p_status: string
        }
        Returns: string
      }
      save_daily_report_items: {
        Args: {
          p_child_id: string
          p_classroom_teacher_id: string
          p_entries: Json
          p_report_date: string
        }
        Returns: string
      }
      submit_daily_report: { Args: { p_report_id: string }; Returns: string }
      switch_classroom: {
        Args: {
          p_child_id: string
          p_end_reason?: string
          p_new_classroom_teacher_id: string
        }
        Returns: undefined
      }
      teacher_classroom_ids: { Args: { p_auth_uid: string }; Returns: string[] }
      teacher_classroom_teacher_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      teacher_daily_report_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      teacher_enrolled_child_ids: {
        Args: { p_auth_uid: string }
        Returns: string[]
      }
      unenroll_child: {
        Args: { p_child_id: string; p_end_reason?: string }
        Returns: undefined
      }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
