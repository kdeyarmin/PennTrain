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
      alerts: {
        Row: {
          alert_type: string
          assigned_to_profile_id: string | null
          certificate_id: string | null
          competency_record_id: string | null
          course_assignment_id: string | null
          created_at: string
          employee_id: string | null
          facility_id: string | null
          id: string
          message: string
          organization_id: string
          practicum_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          training_record_id: string | null
        }
        Insert: {
          alert_type: string
          assigned_to_profile_id?: string | null
          certificate_id?: string | null
          competency_record_id?: string | null
          course_assignment_id?: string | null
          created_at?: string
          employee_id?: string | null
          facility_id?: string | null
          id?: string
          message: string
          organization_id: string
          practicum_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
          training_record_id?: string | null
        }
        Update: {
          alert_type?: string
          assigned_to_profile_id?: string | null
          certificate_id?: string | null
          competency_record_id?: string | null
          course_assignment_id?: string | null
          created_at?: string
          employee_id?: string | null
          facility_id?: string | null
          id?: string
          message?: string
          organization_id?: string
          practicum_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          training_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_practicum_id_fkey"
            columns: ["practicum_id"]
            isOneToOne: false
            referencedRelation: "practicums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "employee_training_records"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_training_hour_buckets: {
        Row: {
          completed_hours: number
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          required_hours: number
          status: string
          training_year: number
          updated_at: string
        }
        Insert: {
          completed_hours?: number
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          required_hours?: number
          status?: string
          training_year: number
          updated_at?: string
        }
        Update: {
          completed_hours?: number
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          required_hours?: number
          status?: string
          training_year?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_training_hour_buckets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_hour_buckets_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_hour_buckets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_training_records: {
        Row: {
          approval_status: string | null
          certificate_number: string | null
          completion_date: string | null
          completion_method: string | null
          created_at: string
          document_required: boolean
          due_date: string | null
          employee_id: string
          external_certificate_document_id: string | null
          facility_id: string
          hours: number | null
          id: string
          notes: string | null
          organization_id: string
          review_comments: string | null
          score: number | null
          status: string
          trainer_credentials: string | null
          trainer_name: string | null
          training_provider: string | null
          training_type_id: string
          updated_at: string
          verified_at: string | null
          verified_by_profile_id: string | null
        }
        Insert: {
          approval_status?: string | null
          certificate_number?: string | null
          completion_date?: string | null
          completion_method?: string | null
          created_at?: string
          document_required?: boolean
          due_date?: string | null
          employee_id: string
          external_certificate_document_id?: string | null
          facility_id: string
          hours?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          review_comments?: string | null
          score?: number | null
          status?: string
          trainer_credentials?: string | null
          trainer_name?: string | null
          training_provider?: string | null
          training_type_id: string
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Update: {
          approval_status?: string | null
          certificate_number?: string | null
          completion_date?: string | null
          completion_method?: string | null
          created_at?: string
          document_required?: boolean
          due_date?: string | null
          employee_id?: string
          external_certificate_document_id?: string | null
          facility_id?: string
          hours?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          review_comments?: string | null
          score?: number | null
          status?: string
          trainer_credentials?: string | null
          trainer_name?: string | null
          training_provider?: string | null
          training_type_id?: string
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_training_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_records_external_cert_doc_fkey"
            columns: ["external_certificate_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_records_training_type_id_fkey"
            columns: ["training_type_id"]
            isOneToOne: false
            referencedRelation: "training_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_training_records_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          administers_medications: boolean
          created_at: string
          department: string | null
          email: string | null
          employee_number: string | null
          facility_id: string
          first_name: string
          hire_date: string | null
          id: string
          job_title: string
          last_name: string
          notes: string | null
          organization_id: string
          phone: string | null
          profile_id: string | null
          status: string
          termination_date: string | null
          trainer_status: boolean
          updated_at: string
        }
        Insert: {
          administers_medications?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          employee_number?: string | null
          facility_id: string
          first_name: string
          hire_date?: string | null
          id?: string
          job_title: string
          last_name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          profile_id?: string | null
          status?: string
          termination_date?: string | null
          trainer_status?: boolean
          updated_at?: string
        }
        Update: {
          administers_medications?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          employee_number?: string | null
          facility_id?: string
          first_name?: string
          hire_date?: string | null
          id?: string
          job_title?: string
          last_name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          profile_id?: string | null
          status?: string
          termination_date?: string | null
          trainer_status?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address: string | null
          administrator_email: string | null
          administrator_name: string | null
          city: string | null
          created_at: string
          facility_type: string
          id: string
          is_active: boolean
          license_number: string | null
          name: string
          organization_id: string
          phone: string | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          administrator_email?: string | null
          administrator_name?: string | null
          city?: string | null
          created_at?: string
          facility_type: string
          id?: string
          is_active?: boolean
          license_number?: string | null
          name: string
          organization_id: string
          phone?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          administrator_email?: string | null
          administrator_name?: string | null
          city?: string | null
          created_at?: string
          facility_type?: string
          id?: string
          is_active?: boolean
          license_number?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_assignments: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          branding_accent_color: string | null
          branding_logo_path: string | null
          branding_primary_color: string | null
          created_at: string
          default_warning_days: Json | null
          email_notifications_enabled: boolean
          id: string
          organization_id: string
          sms_notifications_enabled: boolean
          updated_at: string
        }
        Insert: {
          branding_accent_color?: string | null
          branding_logo_path?: string | null
          branding_primary_color?: string | null
          created_at?: string
          default_warning_days?: Json | null
          email_notifications_enabled?: boolean
          id?: string
          organization_id: string
          sms_notifications_enabled?: boolean
          updated_at?: string
        }
        Update: {
          branding_accent_color?: string | null
          branding_logo_path?: string | null
          branding_primary_color?: string | null
          created_at?: string
          default_warning_days?: Json | null
          email_notifications_enabled?: boolean
          id?: string
          organization_id?: string
          sms_notifications_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          max_facilities: number | null
          max_users: number | null
          name: string
          package_id: string | null
          plan_name: string | null
          slug: string
          state: string | null
          subscription_status: string
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          max_facilities?: number | null
          max_users?: number | null
          name: string
          package_id?: string | null
          plan_name?: string | null
          slug: string
          state?: string | null
          subscription_status?: string
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          max_facilities?: number | null
          max_users?: number | null
          name?: string
          package_id?: string | null
          plan_name?: string | null
          slug?: string
          state?: string | null
          subscription_status?: string
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          facility_limit: number | null
          features: Json | null
          id: string
          is_active: boolean
          learner_limit: number | null
          name: string
          price_monthly_cents: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          facility_limit?: number | null
          features?: Json | null
          id?: string
          is_active?: boolean
          learner_limit?: number | null
          name: string
          price_monthly_cents?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          facility_limit?: number | null
          features?: Json | null
          id?: string
          is_active?: boolean
          learner_limit?: number | null
          name?: string
          price_monthly_cents?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      practicums: {
        Row: {
          certificate_document_id: string | null
          completion_date: string | null
          created_at: string
          direct_observation_completed: boolean
          due_date: string | null
          employee_id: string
          facility_id: string
          id: string
          mar_review_completed: boolean
          notes: string | null
          observation_document_id: string | null
          observed_by: string | null
          organization_id: string
          practicum_year: number
          remediation_notes: string | null
          remediation_required: boolean
          reminder_days: number
          status: string
          updated_at: string
          verified_at: string | null
          verified_by_profile_id: string | null
        }
        Insert: {
          certificate_document_id?: string | null
          completion_date?: string | null
          created_at?: string
          direct_observation_completed?: boolean
          due_date?: string | null
          employee_id: string
          facility_id: string
          id?: string
          mar_review_completed?: boolean
          notes?: string | null
          observation_document_id?: string | null
          observed_by?: string | null
          organization_id: string
          practicum_year: number
          remediation_notes?: string | null
          remediation_required?: boolean
          reminder_days?: number
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Update: {
          certificate_document_id?: string | null
          completion_date?: string | null
          created_at?: string
          direct_observation_completed?: boolean
          due_date?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          mar_review_completed?: boolean
          notes?: string | null
          observation_document_id?: string | null
          observed_by?: string | null
          organization_id?: string
          practicum_year?: number
          remediation_notes?: string | null
          remediation_required?: boolean
          reminder_days?: number
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practicums_certificate_document_fkey"
            columns: ["certificate_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_observation_document_fkey"
            columns: ["observation_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          organization_id: string | null
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string
          id: string
          is_active?: boolean
          last_name?: string
          organization_id?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          organization_id?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_class_attendees: {
        Row: {
          attended: boolean
          class_id: string
          created_at: string
          employee_id: string
          id: string
          training_record_id: string | null
        }
        Insert: {
          attended?: boolean
          class_id: string
          created_at?: string
          employee_id: string
          id?: string
          training_record_id?: string | null
        }
        Update: {
          attended?: boolean
          class_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          training_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_class_attendees_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "training_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_class_attendees_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_class_attendees_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "employee_training_records"
            referencedColumns: ["id"]
          },
        ]
      }
      training_classes: {
        Row: {
          class_date: string
          class_name: string
          created_at: string
          duration_hours: number
          facility_id: string | null
          id: string
          location: string | null
          notes: string | null
          organization_id: string
          roster_document_id: string | null
          status: string
          trainer_profile_id: string
          training_type_id: string
          updated_at: string
        }
        Insert: {
          class_date: string
          class_name: string
          created_at?: string
          duration_hours?: number
          facility_id?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          organization_id: string
          roster_document_id?: string | null
          status?: string
          trainer_profile_id: string
          training_type_id: string
          updated_at?: string
        }
        Update: {
          class_date?: string
          class_name?: string
          created_at?: string
          duration_hours?: number
          facility_id?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          organization_id?: string
          roster_document_id?: string | null
          status?: string
          trainer_profile_id?: string
          training_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_classes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_roster_document_id_fkey"
            columns: ["roster_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_trainer_profile_id_fkey"
            columns: ["trainer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_training_type_id_fkey"
            columns: ["training_type_id"]
            isOneToOne: false
            referencedRelation: "training_types"
            referencedColumns: ["id"]
          },
        ]
      }
      training_documents: {
        Row: {
          created_at: string
          document_type: string
          employee_id: string | null
          facility_id: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          organization_id: string
          storage_bucket: string
          storage_path: string
          training_record_id: string | null
          uploaded_by_profile_id: string | null
        }
        Insert: {
          created_at?: string
          document_type?: string
          employee_id?: string | null
          facility_id: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          organization_id: string
          storage_bucket: string
          storage_path: string
          training_record_id?: string | null
          uploaded_by_profile_id?: string | null
        }
        Update: {
          created_at?: string
          document_type?: string
          employee_id?: string | null
          facility_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          organization_id?: string
          storage_bucket?: string
          storage_path?: string
          training_record_id?: string | null
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_documents_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "employee_training_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_types: {
        Row: {
          accepted_evidence_types: Json | null
          admin_approval_required: boolean
          applies_to_administers_meds: boolean | null
          applies_to_facility_type: string
          applies_to_trainers: boolean | null
          category: string
          citation_note: string | null
          code: string
          created_at: string
          description: string | null
          document_required: boolean
          id: string
          is_active: boolean
          is_system_default: boolean
          name: string
          organization_id: string | null
          renewal_interval_days: number | null
          required_hours: number | null
          required_roles_text: string | null
          sort_order: number
          updated_at: string
          warning_days_default: number
        }
        Insert: {
          accepted_evidence_types?: Json | null
          admin_approval_required?: boolean
          applies_to_administers_meds?: boolean | null
          applies_to_facility_type?: string
          applies_to_trainers?: boolean | null
          category: string
          citation_note?: string | null
          code: string
          created_at?: string
          description?: string | null
          document_required?: boolean
          id?: string
          is_active?: boolean
          is_system_default?: boolean
          name: string
          organization_id?: string | null
          renewal_interval_days?: number | null
          required_hours?: number | null
          required_roles_text?: string | null
          sort_order?: number
          updated_at?: string
          warning_days_default?: number
        }
        Update: {
          accepted_evidence_types?: Json | null
          admin_approval_required?: boolean
          applies_to_administers_meds?: boolean | null
          applies_to_facility_type?: string
          applies_to_trainers?: boolean | null
          category?: string
          citation_note?: string | null
          code?: string
          created_at?: string
          description?: string | null
          document_required?: boolean
          id?: string
          is_active?: boolean
          is_system_default?: boolean
          name?: string
          organization_id?: string | null
          renewal_interval_days?: number | null
          required_hours?: number | null
          required_roles_text?: string | null
          sort_order?: number
          updated_at?: string
          warning_days_default?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_training_class: {
        Args: { p_class_id: string }
        Returns: undefined
      }
      current_org_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      is_assigned_to_facility: {
        Args: { target_facility_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      recalculate_all_compliance: { Args: never; Returns: undefined }
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
