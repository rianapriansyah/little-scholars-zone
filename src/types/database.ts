// Hand-written to match supabase/migrations/20260701120000_v1_core_tables.sql and
// 20260701120100_enrollment_rpcs.sql. Once the supabase-lsz-app MCP is authenticated,
// regenerate this file via the MCP's `generate_typescript_types` tool to keep it in sync.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      families: {
        Row: {
          id: string
          name: string
          contact_phone: string | null
          contact_email: string
          father_name: string | null
          father_occupation: string | null
          father_phone: string | null
          mother_name: string | null
          mother_occupation: string | null
          mother_phone: string | null
          address: string | null
          auth_user_id: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          contact_phone?: string | null
          contact_email: string
          father_name?: string | null
          father_occupation?: string | null
          father_phone?: string | null
          mother_name?: string | null
          mother_occupation?: string | null
          mother_phone?: string | null
          address?: string | null
          auth_user_id?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          contact_phone?: string | null
          contact_email?: string
          father_name?: string | null
          father_occupation?: string | null
          father_phone?: string | null
          mother_name?: string | null
          mother_occupation?: string | null
          mother_phone?: string | null
          address?: string | null
          auth_user_id?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      children: {
        Row: {
          id: string
          family_id: string
          full_name: string
          birthdate: string | null
          notes: string | null
          active: boolean
          created_at: string | null
        }
        Insert: {
          id?: string
          family_id: string
          full_name: string
          birthdate?: string | null
          notes?: string | null
          active?: boolean
          created_at?: string | null
        }
        Update: {
          id?: string
          family_id?: string
          full_name?: string
          birthdate?: string | null
          notes?: string | null
          active?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      teachers: {
        Row: {
          id: string
          full_name: string
          contact_phone: string | null
          email: string
          auth_user_id: string | null
          active: boolean
          created_at: string | null
        }
        Insert: {
          id?: string
          full_name: string
          contact_phone?: string | null
          email: string
          auth_user_id?: string | null
          active?: boolean
          created_at?: string | null
        }
        Update: {
          id?: string
          full_name?: string
          contact_phone?: string | null
          email?: string
          auth_user_id?: string | null
          active?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      classrooms: {
        Row: {
          id: string
          teacher_id: string
          label: string
          days_of_week: string[]
          time_start: string
          time_end: string | null
          capacity: number
          active: boolean
          created_at: string | null
        }
        Insert: {
          id?: string
          teacher_id: string
          label: string
          days_of_week: string[]
          time_start: string
          time_end?: string | null
          capacity?: number
          active?: boolean
          created_at?: string | null
        }
        Update: {
          id?: string
          teacher_id?: string
          label?: string
          days_of_week?: string[]
          time_start?: string
          time_end?: string | null
          capacity?: number
          active?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      children_classrooms: {
        Row: {
          id: string
          child_id: string
          classroom_id: string
          started_at: string
          ended_at: string | null
          end_reason: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          child_id: string
          classroom_id: string
          started_at?: string
          ended_at?: string | null
          end_reason?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          child_id?: string
          classroom_id?: string
          started_at?: string
          ended_at?: string | null
          end_reason?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      enroll_child_in_classroom: {
        Args: { p_child_id: string; p_classroom_id: string }
        Returns: undefined
      }
      switch_classroom: {
        Args: { p_child_id: string; p_new_classroom_id: string; p_end_reason?: string | null }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
