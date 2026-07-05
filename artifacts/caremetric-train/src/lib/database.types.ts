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
      administrator_ce_entries: {
        Row: {
          administrator_profile_id: string
          completed_date: string
          created_at: string
          document_path: string | null
          hours: number
          id: string
          organization_id: string
          provider: string | null
          source: string | null
          topic: string
        }
        Insert: {
          administrator_profile_id: string
          completed_date: string
          created_at?: string
          document_path?: string | null
          hours: number
          id?: string
          organization_id: string
          provider?: string | null
          source?: string | null
          topic: string
        }
        Update: {
          administrator_profile_id?: string
          completed_date?: string
          created_at?: string
          document_path?: string | null
          hours?: number
          id?: string
          organization_id?: string
          provider?: string | null
          source?: string | null
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "administrator_ce_entries_administrator_profile_id_fkey"
            columns: ["administrator_profile_id"]
            isOneToOne: false
            referencedRelation: "administrator_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administrator_ce_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      administrator_profiles: {
        Row: {
          competency_test_date: string | null
          competency_test_passed: boolean
          created_at: string
          hundred_hour_course_completed_date: string | null
          hundred_hour_course_document_path: string | null
          hundred_hour_course_provider: string | null
          id: string
          nha_license_expiration: string | null
          nha_license_number: string | null
          nha_license_state: string | null
          organization_id: string
          profile_id: string
          qualification_path: string | null
          regional_office_verification_document_path: string | null
          regional_office_verification_notes: string | null
          regional_office_verification_submitted_date: string | null
          updated_at: string
        }
        Insert: {
          competency_test_date?: string | null
          competency_test_passed?: boolean
          created_at?: string
          hundred_hour_course_completed_date?: string | null
          hundred_hour_course_document_path?: string | null
          hundred_hour_course_provider?: string | null
          id?: string
          nha_license_expiration?: string | null
          nha_license_number?: string | null
          nha_license_state?: string | null
          organization_id: string
          profile_id: string
          qualification_path?: string | null
          regional_office_verification_document_path?: string | null
          regional_office_verification_notes?: string | null
          regional_office_verification_submitted_date?: string | null
          updated_at?: string
        }
        Update: {
          competency_test_date?: string | null
          competency_test_passed?: boolean
          created_at?: string
          hundred_hour_course_completed_date?: string | null
          hundred_hour_course_document_path?: string | null
          hundred_hour_course_provider?: string | null
          id?: string
          nha_license_expiration?: string | null
          nha_license_number?: string | null
          nha_license_state?: string | null
          organization_id?: string
          profile_id?: string
          qualification_path?: string | null
          regional_office_verification_document_path?: string | null
          regional_office_verification_notes?: string | null
          regional_office_verification_submitted_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "administrator_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administrator_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          assigned_to_profile_id: string | null
          certificate_id: string | null
          competency_record_id: string | null
          corrective_action_id: string | null
          course_assignment_id: string | null
          created_at: string
          employee_credential_id: string | null
          employee_id: string | null
          escalated_at: string | null
          exclusion_screening_match_id: string | null
          facility_id: string | null
          id: string
          incident_notification_id: string | null
          inspection_item_id: string | null
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
          corrective_action_id?: string | null
          course_assignment_id?: string | null
          created_at?: string
          employee_credential_id?: string | null
          employee_id?: string | null
          escalated_at?: string | null
          exclusion_screening_match_id?: string | null
          facility_id?: string | null
          id?: string
          incident_notification_id?: string | null
          inspection_item_id?: string | null
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
          corrective_action_id?: string | null
          course_assignment_id?: string | null
          created_at?: string
          employee_credential_id?: string | null
          employee_id?: string | null
          escalated_at?: string | null
          exclusion_screening_match_id?: string | null
          facility_id?: string | null
          id?: string
          incident_notification_id?: string | null
          inspection_item_id?: string | null
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
            foreignKeyName: "alerts_corrective_action_id_fkey"
            columns: ["corrective_action_id"]
            isOneToOne: false
            referencedRelation: "corrective_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_employee_credential_id_fkey"
            columns: ["employee_credential_id"]
            isOneToOne: false
            referencedRelation: "employee_credentials"
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
            foreignKeyName: "alerts_exclusion_screening_match_id_fkey"
            columns: ["exclusion_screening_match_id"]
            isOneToOne: false
            referencedRelation: "exclusion_screening_matches"
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
            foreignKeyName: "alerts_incident_notification_id_fkey"
            columns: ["incident_notification_id"]
            isOneToOne: false
            referencedRelation: "incident_notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: false
            referencedRelation: "inspection_items"
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
      certificates: {
        Row: {
          course_assignment_id: string | null
          course_id: string
          created_at: string
          employee_id: string
          expires_at: string | null
          facility_id: string
          id: string
          issued_at: string
          organization_id: string
          pdf_storage_bucket: string | null
          pdf_storage_path: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          course_assignment_id?: string | null
          course_id: string
          created_at?: string
          employee_id: string
          expires_at?: string | null
          facility_id: string
          id?: string
          issued_at?: string
          organization_id: string
          pdf_storage_bucket?: string | null
          pdf_storage_path?: string | null
          slug?: string
          updated_at?: string
        }
        Update: {
          course_assignment_id?: string | null
          course_id?: string
          created_at?: string
          employee_id?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          issued_at?: string
          organization_id?: string
          pdf_storage_bucket?: string | null
          pdf_storage_path?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_assignment_id_fkey"
            columns: ["course_assignment_id"]
            isOneToOne: true
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_checkin_tokens: {
        Row: {
          class_id: string
          created_at: string
          expires_at: string
          id: string
          token: string
        }
        Insert: {
          class_id: string
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_checkin_tokens_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "training_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_record_items: {
        Row: {
          competency_record_id: string
          created_at: string
          id: string
          notes: string | null
          result: string
          template_item_id: string | null
        }
        Insert: {
          competency_record_id: string
          created_at?: string
          id?: string
          notes?: string | null
          result: string
          template_item_id?: string | null
        }
        Update: {
          competency_record_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          result?: string
          template_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competency_record_items_competency_record_id_fkey"
            columns: ["competency_record_id"]
            isOneToOne: false
            referencedRelation: "competency_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_record_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "competency_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_records: {
        Row: {
          created_at: string
          employee_id: string
          evaluation_date: string
          evaluator_profile_id: string | null
          facility_id: string
          id: string
          organization_id: string
          overall_result: string
          signed_at: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          evaluation_date: string
          evaluator_profile_id?: string | null
          facility_id: string
          id?: string
          organization_id: string
          overall_result: string
          signed_at?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          evaluation_date?: string
          evaluator_profile_id?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          overall_result?: string
          signed_at?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competency_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_records_evaluator_profile_id_fkey"
            columns: ["evaluator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_records_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "competency_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_template_items: {
        Row: {
          created_at: string
          id: string
          item_text: string
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_text: string
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_text?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competency_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "competency_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competency_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      corrective_actions: {
        Row: {
          completed_date: string | null
          course_assignment_id: string | null
          created_at: string
          description: string
          due_date: string
          facility_id: string
          id: string
          incident_id: string | null
          inspection_event_id: string | null
          organization_id: string
          owner_name: string | null
          owner_profile_id: string | null
          status: string
          updated_at: string
          verification_notes: string | null
          violation_id: string | null
        }
        Insert: {
          completed_date?: string | null
          course_assignment_id?: string | null
          created_at?: string
          description: string
          due_date: string
          facility_id: string
          id?: string
          incident_id?: string | null
          inspection_event_id?: string | null
          organization_id: string
          owner_name?: string | null
          owner_profile_id?: string | null
          status?: string
          updated_at?: string
          verification_notes?: string | null
          violation_id?: string | null
        }
        Update: {
          completed_date?: string | null
          course_assignment_id?: string | null
          created_at?: string
          description?: string
          due_date?: string
          facility_id?: string
          id?: string
          incident_id?: string | null
          inspection_event_id?: string | null
          organization_id?: string
          owner_name?: string | null
          owner_profile_id?: string | null
          status?: string
          updated_at?: string
          verification_notes?: string | null
          violation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corrective_actions_course_assignment_id_fkey"
            columns: ["course_assignment_id"]
            isOneToOne: false
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_inspection_event_id_fkey"
            columns: ["inspection_event_id"]
            isOneToOne: false
            referencedRelation: "inspection_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_violation_id_fkey"
            columns: ["violation_id"]
            isOneToOne: false
            referencedRelation: "dhs_violations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_ai_generations: {
        Row: {
          course_block_id: string | null
          course_id: string | null
          course_version_id: string | null
          created_at: string
          error_message: string | null
          id: string
          kind: string
          model: string
          request_params: Json
          requested_by: string
          response_summary: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          course_block_id?: string | null
          course_id?: string | null
          course_version_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          kind: string
          model: string
          request_params: Json
          requested_by: string
          response_summary?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          course_block_id?: string | null
          course_id?: string | null
          course_version_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          kind?: string
          model?: string
          request_params?: Json
          requested_by?: string
          response_summary?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_ai_generations_course_block_id_fkey"
            columns: ["course_block_id"]
            isOneToOne: false
            referencedRelation: "course_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_ai_generations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_ai_generations_course_version_id_fkey"
            columns: ["course_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_ai_generations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_ai_generations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          course_id: string
          course_version_id: string
          due_date: string | null
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          status: string
          training_plan_id: string | null
          training_plan_item_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          course_id: string
          course_version_id: string
          due_date?: string | null
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          status?: string
          training_plan_id?: string | null
          training_plan_item_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          course_id?: string
          course_version_id?: string
          due_date?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          status?: string
          training_plan_id?: string | null
          training_plan_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_course_version_id_fkey"
            columns: ["course_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_assignments_training_plan_item_id_fkey"
            columns: ["training_plan_item_id"]
            isOneToOne: false
            referencedRelation: "training_plan_items"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blocks: {
        Row: {
          block_type: string
          body: Json | null
          course_version_id: string
          created_at: string
          document_id: string | null
          id: string
          organization_id: string | null
          sort_order: number
          title: string | null
          video_url: string | null
        }
        Insert: {
          block_type: string
          body?: Json | null
          course_version_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          organization_id?: string | null
          sort_order?: number
          title?: string | null
          video_url?: string | null
        }
        Update: {
          block_type?: string
          body?: Json | null
          course_version_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          organization_id?: string | null
          sort_order?: number
          title?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_blocks_course_version_id_fkey"
            columns: ["course_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blocks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_feedback: {
        Row: {
          comment: string | null
          course_assignment_id: string
          course_id: string
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          rating: number
        }
        Insert: {
          comment?: string | null
          course_assignment_id: string
          course_id: string
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          rating: number
        }
        Update: {
          comment?: string | null
          course_assignment_id?: string
          course_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_feedback_course_assignment_id_fkey"
            columns: ["course_assignment_id"]
            isOneToOne: true
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_feedback_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_feedback_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_progress: {
        Row: {
          assignment_id: string
          id: string
          last_block_id: string | null
          percent_complete: number
          started_at: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          id?: string
          last_block_id?: string | null
          percent_complete?: number
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          id?: string
          last_block_id?: string | null
          percent_complete?: number
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_progress_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_progress_last_block_id_fkey"
            columns: ["last_block_id"]
            isOneToOne: false
            referencedRelation: "course_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      course_versions: {
        Row: {
          ai_generated: boolean
          ai_reviewed_at: string | null
          ai_reviewed_by: string | null
          course_id: string
          created_at: string
          description: string | null
          id: string
          organization_id: string | null
          published_at: string | null
          status: string
          title: string
          version_number: number
        }
        Insert: {
          ai_generated?: boolean
          ai_reviewed_at?: string | null
          ai_reviewed_by?: string | null
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          published_at?: string | null
          status?: string
          title: string
          version_number: number
        }
        Update: {
          ai_generated?: boolean
          ai_reviewed_at?: string | null
          ai_reviewed_by?: string | null
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          published_at?: string | null
          status?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_versions_ai_reviewed_by_fkey"
            columns: ["ai_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_versions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          estimated_duration_minutes: number | null
          id: string
          organization_id: string | null
          status: string
          title: string
          training_type_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          estimated_duration_minutes?: number | null
          id?: string
          organization_id?: string | null
          status?: string
          title: string
          training_type_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          estimated_duration_minutes?: number | null
          id?: string
          organization_id?: string | null
          status?: string
          title?: string
          training_type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_training_type_id_fkey"
            columns: ["training_type_id"]
            isOneToOne: false
            referencedRelation: "training_types"
            referencedColumns: ["id"]
          },
        ]
      }
      dhs_citation_topics: {
        Row: {
          category: string
          chapter: string
          citation_ref: string | null
          created_at: string
          frequency_weight: number
          id: string
          notes: string | null
          sort_order: number
          title: string
        }
        Insert: {
          category: string
          chapter: string
          citation_ref?: string | null
          created_at?: string
          frequency_weight?: number
          id?: string
          notes?: string | null
          sort_order?: number
          title: string
        }
        Update: {
          category?: string
          chapter?: string
          citation_ref?: string | null
          created_at?: string
          frequency_weight?: number
          id?: string
          notes?: string | null
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      dhs_violations: {
        Row: {
          citation_ref: string | null
          citation_topic_id: string | null
          created_at: string
          description: string
          facility_id: string
          id: string
          inspection_date: string
          organization_id: string
          poc_due_date: string | null
          poc_submitted_at: string | null
          severity: string
          status: string
          surveyor_name: string | null
          updated_at: string
          verified_at: string | null
          verified_by_profile_id: string | null
        }
        Insert: {
          citation_ref?: string | null
          citation_topic_id?: string | null
          created_at?: string
          description: string
          facility_id: string
          id?: string
          inspection_date: string
          organization_id: string
          poc_due_date?: string | null
          poc_submitted_at?: string | null
          severity?: string
          status?: string
          surveyor_name?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Update: {
          citation_ref?: string | null
          citation_topic_id?: string | null
          created_at?: string
          description?: string
          facility_id?: string
          id?: string
          inspection_date?: string
          organization_id?: string
          poc_due_date?: string | null
          poc_submitted_at?: string | null
          severity?: string
          status?: string
          surveyor_name?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dhs_violations_citation_topic_id_fkey"
            columns: ["citation_topic_id"]
            isOneToOne: false
            referencedRelation: "dhs_citation_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dhs_violations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dhs_violations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dhs_violations_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_background_check_profiles: {
        Row: {
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          non_disqualification_statement_signed: boolean
          non_disqualification_statement_signed_at: string | null
          organization_id: string
          pa_resident_two_years: boolean | null
          provisional_max_days: number | null
          provisional_start_date: string | null
          suitability_conditions: string | null
          suitability_determination: string
          suitability_determined_at: string | null
          suitability_determined_by: string | null
          suitability_notes: string | null
          supervision_attestation_confirmed: boolean
          supervision_attestation_confirmed_at: string | null
          supervision_attestation_confirmed_by: string | null
          supervision_attestation_notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          non_disqualification_statement_signed?: boolean
          non_disqualification_statement_signed_at?: string | null
          organization_id: string
          pa_resident_two_years?: boolean | null
          provisional_max_days?: number | null
          provisional_start_date?: string | null
          suitability_conditions?: string | null
          suitability_determination?: string
          suitability_determined_at?: string | null
          suitability_determined_by?: string | null
          suitability_notes?: string | null
          supervision_attestation_confirmed?: boolean
          supervision_attestation_confirmed_at?: string | null
          supervision_attestation_confirmed_by?: string | null
          supervision_attestation_notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          non_disqualification_statement_signed?: boolean
          non_disqualification_statement_signed_at?: string | null
          organization_id?: string
          pa_resident_two_years?: boolean | null
          provisional_max_days?: number | null
          provisional_start_date?: string | null
          suitability_conditions?: string | null
          suitability_determination?: string
          suitability_determined_at?: string | null
          suitability_determined_by?: string | null
          suitability_notes?: string | null
          supervision_attestation_confirmed?: boolean
          supervision_attestation_confirmed_at?: string | null
          supervision_attestation_confirmed_by?: string | null
          supervision_attestation_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_background_check_pro_supervision_attestation_conf_fkey"
            columns: ["supervision_attestation_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_background_check_profil_suitability_determined_by_fkey"
            columns: ["suitability_determined_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_background_check_profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_background_check_profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_background_check_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_checkin_logs: {
        Row: {
          check_in_day: number
          completed_at: string
          completed_by_profile_id: string | null
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          check_in_day: number
          completed_at?: string
          completed_by_profile_id?: string | null
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          check_in_day?: number
          completed_at?: string
          completed_by_profile_id?: string | null
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_checkin_logs_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_checkin_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_checkin_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_checkin_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_credential_documents: {
        Row: {
          created_at: string
          credential_id: string
          document_label: string | null
          employee_id: string
          facility_id: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          organization_id: string
          retain_until: string | null
          storage_bucket: string
          storage_path: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          created_at?: string
          credential_id: string
          document_label?: string | null
          employee_id: string
          facility_id: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          organization_id: string
          retain_until?: string | null
          storage_bucket?: string
          storage_path: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          created_at?: string
          credential_id?: string
          document_label?: string | null
          employee_id?: string
          facility_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          organization_id?: string
          retain_until?: string | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_credential_documents_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "employee_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credential_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credential_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credential_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credential_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_credentials: {
        Row: {
          citation_topic_id: string | null
          created_at: string
          credential_label: string | null
          credential_number: string | null
          credential_type: string
          employee_id: string
          expiration_date: string | null
          facility_id: string
          id: string
          issue_date: string | null
          issuing_authority: string | null
          last_verified_date: string | null
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
          verification_method: string | null
          verified_at: string | null
          verified_by_profile_id: string | null
          warning_days: number
        }
        Insert: {
          citation_topic_id?: string | null
          created_at?: string
          credential_label?: string | null
          credential_number?: string | null
          credential_type: string
          employee_id: string
          expiration_date?: string | null
          facility_id: string
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          last_verified_date?: string | null
          notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by_profile_id?: string | null
          warning_days?: number
        }
        Update: {
          citation_topic_id?: string | null
          created_at?: string
          credential_label?: string | null
          credential_number?: string | null
          credential_type?: string
          employee_id?: string
          expiration_date?: string | null
          facility_id?: string
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          last_verified_date?: string | null
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by_profile_id?: string | null
          warning_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_credentials_citation_topic_id_fkey"
            columns: ["citation_topic_id"]
            isOneToOne: false
            referencedRelation: "dhs_citation_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credentials_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credentials_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_credentials_verified_by_profile_id_fkey"
            columns: ["verified_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_onboarding_items: {
        Row: {
          category: string
          completed_at: string | null
          completed_by_profile_id: string | null
          created_at: string
          due_date: string | null
          employee_id: string
          facility_id: string
          id: string
          is_blocking: boolean
          label: string
          notes: string | null
          organization_id: string
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          created_at?: string
          due_date?: string | null
          employee_id: string
          facility_id: string
          id?: string
          is_blocking?: boolean
          label: string
          notes?: string | null
          organization_id: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          completed_at?: string | null
          completed_by_profile_id?: string | null
          created_at?: string
          due_date?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          is_blocking?: boolean
          label?: string
          notes?: string | null
          organization_id?: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_onboarding_items_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "onboarding_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_training_hour_buckets: {
        Row: {
          bucket_type: string
          completed_hours: number
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          ojt_hours: number
          organization_id: string
          required_hours: number
          status: string
          training_year: number
          updated_at: string
        }
        Insert: {
          bucket_type?: string
          completed_hours?: number
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          ojt_hours?: number
          organization_id: string
          required_hours?: number
          status?: string
          training_year: number
          updated_at?: string
        }
        Update: {
          bucket_type?: string
          completed_hours?: number
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          ojt_hours?: number
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
          checkin_pin_hash: string | null
          cleared_for_unsupervised_duty: boolean
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
          scheduled_hours_per_week: number | null
          status: string
          termination_date: string | null
          trainer_status: boolean
          updated_at: string
          worker_type: string
        }
        Insert: {
          administers_medications?: boolean
          checkin_pin_hash?: string | null
          cleared_for_unsupervised_duty?: boolean
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
          scheduled_hours_per_week?: number | null
          status?: string
          termination_date?: string | null
          trainer_status?: boolean
          updated_at?: string
          worker_type?: string
        }
        Update: {
          administers_medications?: boolean
          checkin_pin_hash?: string | null
          cleared_for_unsupervised_duty?: boolean
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
          scheduled_hours_per_week?: number | null
          status?: string
          termination_date?: string | null
          trainer_status?: boolean
          updated_at?: string
          worker_type?: string
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
      entrance_conference_items: {
        Row: {
          category: string
          created_at: string
          data_source: string
          id: string
          is_active: boolean
          organization_id: string | null
          prompt: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          data_source: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          prompt: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data_source?: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entrance_conference_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exclusion_list_entries: {
        Row: {
          business_name: string | null
          dob: string | null
          exclusion_date: string | null
          exclusion_type: string | null
          first_name: string | null
          id: string
          imported_at: string
          last_name: string | null
          middle_name: string | null
          npi: string | null
          raw: Json | null
          reinstate_date: string | null
          source: string
          upin: string | null
          waiver_date: string | null
        }
        Insert: {
          business_name?: string | null
          dob?: string | null
          exclusion_date?: string | null
          exclusion_type?: string | null
          first_name?: string | null
          id?: string
          imported_at?: string
          last_name?: string | null
          middle_name?: string | null
          npi?: string | null
          raw?: Json | null
          reinstate_date?: string | null
          source: string
          upin?: string | null
          waiver_date?: string | null
        }
        Update: {
          business_name?: string | null
          dob?: string | null
          exclusion_date?: string | null
          exclusion_type?: string | null
          first_name?: string | null
          id?: string
          imported_at?: string
          last_name?: string | null
          middle_name?: string | null
          npi?: string | null
          raw?: Json | null
          reinstate_date?: string | null
          source?: string
          upin?: string | null
          waiver_date?: string | null
        }
        Relationships: []
      }
      exclusion_screening_matches: {
        Row: {
          created_at: string
          employee_id: string
          exclusion_list_entry_id: string
          facility_id: string
          id: string
          match_score: number
          matched_name: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_notes: string | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          exclusion_list_entry_id: string
          facility_id: string
          id?: string
          match_score: number
          matched_name: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_notes?: string | null
          source: string
          status?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          exclusion_list_entry_id?: string
          facility_id?: string
          id?: string
          match_score?: number
          matched_name?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_notes?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_screening_matches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusion_screening_matches_exclusion_list_entry_id_fkey"
            columns: ["exclusion_list_entry_id"]
            isOneToOne: false
            referencedRelation: "exclusion_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusion_screening_matches_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusion_screening_matches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusion_screening_matches_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
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
      incident_documents: {
        Row: {
          created_at: string
          document_label: string | null
          facility_id: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          incident_id: string
          organization_id: string
          retain_until: string | null
          storage_bucket: string
          storage_path: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          created_at?: string
          document_label?: string | null
          facility_id: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          incident_id: string
          organization_id: string
          retain_until?: string | null
          storage_bucket?: string
          storage_path: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          created_at?: string
          document_label?: string | null
          facility_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          incident_id?: string
          organization_id?: string
          retain_until?: string | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_documents_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notifications: {
        Row: {
          completed_at: string | null
          completed_by_profile_id: string | null
          created_at: string
          due_at: string
          facility_id: string
          id: string
          incident_id: string
          notes: string | null
          notification_method: string | null
          notification_type: string
          organization_id: string
          recipient: string | null
          reference_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by_profile_id?: string | null
          created_at?: string
          due_at: string
          facility_id: string
          id?: string
          incident_id: string
          notes?: string | null
          notification_method?: string | null
          notification_type: string
          organization_id: string
          recipient?: string | null
          reference_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by_profile_id?: string | null
          created_at?: string
          due_at?: string
          facility_id?: string
          id?: string
          incident_id?: string
          notes?: string | null
          notification_method?: string | null
          notification_type?: string
          organization_id?: string
          recipient?: string | null
          reference_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_notifications_completed_by_profile_id_fkey"
            columns: ["completed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notifications_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_staff_involved: {
        Row: {
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          incident_id: string
          involvement_type: string
          organization_id: string
          statement: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          incident_id: string
          involvement_type: string
          organization_id: string
          statement?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          incident_id?: string
          involvement_type?: string
          organization_id?: string
          statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_staff_involved_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_staff_involved_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_staff_involved_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_staff_involved_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          closed_at: string | null
          closed_by_profile_id: string | null
          created_at: string
          facility_id: string
          final_report_document_id: string | null
          final_report_submitted_at: string | null
          id: string
          incident_type: string
          investigation_findings: string | null
          investigation_started_at: string | null
          investigator_name: string | null
          investigator_profile_id: string | null
          location_detail: string | null
          narrative: string
          occurred_at: string
          organization_id: string
          report_pdf_storage_bucket: string | null
          report_pdf_storage_path: string | null
          reported_at: string
          reported_by_profile_id: string | null
          resident_identifier: string | null
          root_cause: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by_profile_id?: string | null
          created_at?: string
          facility_id: string
          final_report_document_id?: string | null
          final_report_submitted_at?: string | null
          id?: string
          incident_type: string
          investigation_findings?: string | null
          investigation_started_at?: string | null
          investigator_name?: string | null
          investigator_profile_id?: string | null
          location_detail?: string | null
          narrative: string
          occurred_at: string
          organization_id: string
          report_pdf_storage_bucket?: string | null
          report_pdf_storage_path?: string | null
          reported_at?: string
          reported_by_profile_id?: string | null
          resident_identifier?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by_profile_id?: string | null
          created_at?: string
          facility_id?: string
          final_report_document_id?: string | null
          final_report_submitted_at?: string | null
          id?: string
          incident_type?: string
          investigation_findings?: string | null
          investigation_started_at?: string | null
          investigator_name?: string | null
          investigator_profile_id?: string | null
          location_detail?: string | null
          narrative?: string
          occurred_at?: string
          organization_id?: string
          report_pdf_storage_bucket?: string | null
          report_pdf_storage_path?: string | null
          reported_at?: string
          reported_by_profile_id?: string | null
          resident_identifier?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_closed_by_profile_id_fkey"
            columns: ["closed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_final_report_document_id_fkey"
            columns: ["final_report_document_id"]
            isOneToOne: false
            referencedRelation: "incident_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_investigator_profile_id_fkey"
            columns: ["investigator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_reported_by_profile_id_fkey"
            columns: ["reported_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_events: {
        Row: {
          alarm_or_detector_operative: boolean | null
          created_at: string
          deficiency_notes: string | null
          drill_time: string | null
          evacuation_duration_seconds: number | null
          exit_route_used: string | null
          facility_id: string
          follow_up_required: boolean
          id: string
          inspection_item_id: string
          is_sleeping_hours_drill: boolean
          notes: string | null
          organization_id: string
          performed_by: string
          performed_by_profile_id: string | null
          performed_date: string
          problems_encountered: string | null
          residents_evacuated_count: number | null
          residents_present_count: number | null
          result: string
          shift: string | null
          staff_participating_count: number | null
          updated_at: string
        }
        Insert: {
          alarm_or_detector_operative?: boolean | null
          created_at?: string
          deficiency_notes?: string | null
          drill_time?: string | null
          evacuation_duration_seconds?: number | null
          exit_route_used?: string | null
          facility_id: string
          follow_up_required?: boolean
          id?: string
          inspection_item_id: string
          is_sleeping_hours_drill?: boolean
          notes?: string | null
          organization_id: string
          performed_by: string
          performed_by_profile_id?: string | null
          performed_date: string
          problems_encountered?: string | null
          residents_evacuated_count?: number | null
          residents_present_count?: number | null
          result: string
          shift?: string | null
          staff_participating_count?: number | null
          updated_at?: string
        }
        Update: {
          alarm_or_detector_operative?: boolean | null
          created_at?: string
          deficiency_notes?: string | null
          drill_time?: string | null
          evacuation_duration_seconds?: number | null
          exit_route_used?: string | null
          facility_id?: string
          follow_up_required?: boolean
          id?: string
          inspection_item_id?: string
          is_sleeping_hours_drill?: boolean
          notes?: string | null
          organization_id?: string
          performed_by?: string
          performed_by_profile_id?: string | null
          performed_date?: string
          problems_encountered?: string | null
          residents_evacuated_count?: number | null
          residents_present_count?: number | null
          result?: string
          shift?: string | null
          staff_participating_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_events_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: false
            referencedRelation: "inspection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_events_performed_by_profile_id_fkey"
            columns: ["performed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_items: {
        Row: {
          citation_topic_id: string | null
          created_at: string
          facility_id: string
          id: string
          inspection_interval_days: number
          install_date: string | null
          is_active: boolean
          item_kind: string
          item_type: string
          label: string
          last_inspected_date: string | null
          location_detail: string | null
          manufacturer: string | null
          model_number: string | null
          next_due_date: string | null
          notes: string | null
          organization_id: string
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          citation_topic_id?: string | null
          created_at?: string
          facility_id: string
          id?: string
          inspection_interval_days: number
          install_date?: string | null
          is_active?: boolean
          item_kind: string
          item_type: string
          label: string
          last_inspected_date?: string | null
          location_detail?: string | null
          manufacturer?: string | null
          model_number?: string | null
          next_due_date?: string | null
          notes?: string | null
          organization_id: string
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          citation_topic_id?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          inspection_interval_days?: number
          install_date?: string | null
          is_active?: boolean
          item_kind?: string
          item_type?: string
          label?: string
          last_inspected_date?: string | null
          location_detail?: string | null
          manufacturer?: string | null
          model_number?: string | null
          next_due_date?: string | null
          notes?: string | null
          organization_id?: string
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_items_citation_topic_id_fkey"
            columns: ["citation_topic_id"]
            isOneToOne: false
            referencedRelation: "dhs_citation_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          channel: string
          created_at: string
          delivery_type: string
          error_message: string | null
          id: string
          notification_id: string | null
          organization_id: string
          profile_id: string
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string
          delivery_type?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          organization_id: string
          profile_id: string
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          delivery_type?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          organization_id?: string
          profile_id?: string
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          notification_type: string
          organization_id: string
          profile_id: string
          read_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          notification_type: string
          organization_id: string
          profile_id: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          notification_type?: string
          organization_id?: string
          profile_id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_checklist_templates: {
        Row: {
          applies_to_facility_type: string
          applies_to_track: string
          category: string
          code: string
          created_at: string
          deadline_basis: string
          deadline_value: number | null
          id: string
          is_active: boolean
          is_blocking: boolean
          label: string
          organization_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          applies_to_facility_type?: string
          applies_to_track?: string
          category: string
          code: string
          created_at?: string
          deadline_basis: string
          deadline_value?: number | null
          id?: string
          is_active?: boolean
          is_blocking?: boolean
          label: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          applies_to_facility_type?: string
          applies_to_track?: string
          category?: string
          code?: string
          created_at?: string
          deadline_basis?: string
          deadline_value?: number | null
          id?: string
          is_active?: boolean
          is_blocking?: boolean
          label?: string
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          oapsa_provisional_days_nonresident: number
          oapsa_provisional_days_resident: number
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
          oapsa_provisional_days_nonresident?: number
          oapsa_provisional_days_resident?: number
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
          oapsa_provisional_days_nonresident?: number
          oapsa_provisional_days_resident?: number
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
      policy_attestation_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          name: string
          organization_id: string
          policy_document_id: string
          policy_document_version_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          name: string
          organization_id: string
          policy_document_id: string
          policy_document_version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          name?: string
          organization_id?: string
          policy_document_id?: string
          policy_document_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_attestation_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestation_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestation_campaigns_policy_document_id_fkey"
            columns: ["policy_document_id"]
            isOneToOne: false
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestation_campaigns_policy_document_version_id_fkey"
            columns: ["policy_document_version_id"]
            isOneToOne: false
            referencedRelation: "policy_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_attestations: {
        Row: {
          attested_at: string | null
          auth_method: string | null
          campaign_id: string
          created_at: string
          document_version_hash: string | null
          due_date: string | null
          employee_id: string
          facility_id: string
          id: string
          ip_address: string | null
          organization_id: string
          policy_document_version_id: string
          reminder_sent_at: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          attested_at?: string | null
          auth_method?: string | null
          campaign_id: string
          created_at?: string
          document_version_hash?: string | null
          due_date?: string | null
          employee_id: string
          facility_id: string
          id?: string
          ip_address?: string | null
          organization_id: string
          policy_document_version_id: string
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          attested_at?: string | null
          auth_method?: string | null
          campaign_id?: string
          created_at?: string
          document_version_hash?: string | null
          due_date?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          ip_address?: string | null
          organization_id?: string
          policy_document_version_id?: string
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "policy_attestations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "policy_attestation_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_attestations_policy_document_version_id_fkey"
            columns: ["policy_document_version_id"]
            isOneToOne: false
            referencedRelation: "policy_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_document_versions: {
        Row: {
          content_hash: string
          created_at: string
          created_by: string | null
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          organization_id: string
          policy_document_id: string
          published_at: string | null
          status: string
          storage_bucket: string
          storage_path: string
          version_number: number
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          organization_id: string
          policy_document_id: string
          published_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path: string
          version_number: number
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          organization_id?: string
          policy_document_id?: string
          published_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "policy_document_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_document_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_document_versions_policy_document_id_fkey"
            columns: ["policy_document_id"]
            isOneToOne: false
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_documents: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_documents_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "policy_document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          window1_evidence_document_id: string | null
          window1_mar_review_by: string | null
          window1_mar_review_date: string | null
          window1_observation_by: string | null
          window1_observation_date: string | null
          window2_evidence_document_id: string | null
          window2_mar_review_by: string | null
          window2_mar_review_date: string | null
          window2_observation_by: string | null
          window2_observation_date: string | null
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
          window1_evidence_document_id?: string | null
          window1_mar_review_by?: string | null
          window1_mar_review_date?: string | null
          window1_observation_by?: string | null
          window1_observation_date?: string | null
          window2_evidence_document_id?: string | null
          window2_mar_review_by?: string | null
          window2_mar_review_date?: string | null
          window2_observation_by?: string | null
          window2_observation_date?: string | null
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
          window1_evidence_document_id?: string | null
          window1_mar_review_by?: string | null
          window1_mar_review_date?: string | null
          window1_observation_by?: string | null
          window1_observation_date?: string | null
          window2_evidence_document_id?: string | null
          window2_mar_review_by?: string | null
          window2_mar_review_date?: string | null
          window2_observation_by?: string | null
          window2_observation_date?: string | null
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
          {
            foreignKeyName: "practicums_window1_evidence_document_id_fkey"
            columns: ["window1_evidence_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_window1_mar_review_by_fkey"
            columns: ["window1_mar_review_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_window1_observation_by_fkey"
            columns: ["window1_observation_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_window2_evidence_document_id_fkey"
            columns: ["window2_evidence_document_id"]
            isOneToOne: false
            referencedRelation: "training_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_window2_mar_review_by_fkey"
            columns: ["window2_mar_review_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicums_window2_observation_by_fkey"
            columns: ["window2_observation_by"]
            isOneToOne: false
            referencedRelation: "employees"
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
          sms_consent_at: string | null
          sms_opt_in: boolean
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
          sms_consent_at?: string | null
          sms_opt_in?: boolean
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
          sms_consent_at?: string | null
          sms_opt_in?: boolean
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
      quiz_answers: {
        Row: {
          answer_text: string
          created_at: string
          id: string
          is_correct: boolean
          organization_id: string | null
          question_id: string
          sort_order: number
        }
        Insert: {
          answer_text: string
          created_at?: string
          id?: string
          is_correct?: boolean
          organization_id?: string | null
          question_id: string
          sort_order?: number
        }
        Update: {
          answer_text?: string
          created_at?: string
          id?: string
          is_correct?: boolean
          organization_id?: string | null
          question_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_answers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempt_answers: {
        Row: {
          attempt_id: string
          created_at: string
          id: string
          is_correct: boolean | null
          question_id: string
          selected_answer_ids: string[]
        }
        Insert: {
          attempt_id: string
          created_at?: string
          id?: string
          is_correct?: boolean | null
          question_id: string
          selected_answer_ids?: string[]
        }
        Update: {
          attempt_id?: string
          created_at?: string
          id?: string
          is_correct?: boolean | null
          question_id?: string
          selected_answer_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempt_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "quiz_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempt_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          assignment_id: string
          attempt_number: number
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          passed: boolean | null
          quiz_id: string
          score_percent: number | null
          started_at: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          attempt_number?: number
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          passed?: boolean | null
          quiz_id: string
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          attempt_number?: number
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          passed?: boolean | null
          quiz_id?: string
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_question_explanations: {
        Row: {
          created_at: string
          explanation: string
          organization_id: string | null
          question_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          explanation: string
          organization_id?: string | null
          question_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          explanation?: string
          organization_id?: string | null
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_question_explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_question_explanations_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          points: number
          question_text: string
          question_type: string
          quiz_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          points?: number
          question_text: string
          question_type: string
          quiz_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          points?: number
          question_text?: string
          question_type?: string
          quiz_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          course_block_id: string
          created_at: string
          id: string
          max_attempts: number | null
          organization_id: string | null
          passing_score_percent: number
          title: string
        }
        Insert: {
          course_block_id: string
          created_at?: string
          id?: string
          max_attempts?: number | null
          organization_id?: string | null
          passing_score_percent?: number
          title: string
        }
        Update: {
          course_block_id?: string
          created_at?: string
          id?: string
          max_attempts?: number | null
          organization_id?: string | null
          passing_score_percent?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_course_block_id_fkey"
            columns: ["course_block_id"]
            isOneToOne: true
            referencedRelation: "course_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_compliance_items: {
        Row: {
          citation_topic_id: string | null
          completed_date: string | null
          created_at: string
          due_date: string | null
          facility_id: string
          id: string
          item_type: string
          notes: string | null
          organization_id: string
          renewal_interval_days: number | null
          resident_id: string
          status: string
          updated_at: string
          warning_days: number
        }
        Insert: {
          citation_topic_id?: string | null
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          facility_id: string
          id?: string
          item_type: string
          notes?: string | null
          organization_id: string
          renewal_interval_days?: number | null
          resident_id: string
          status?: string
          updated_at?: string
          warning_days?: number
        }
        Update: {
          citation_topic_id?: string | null
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          facility_id?: string
          id?: string
          item_type?: string
          notes?: string | null
          organization_id?: string
          renewal_interval_days?: number | null
          resident_id?: string
          status?: string
          updated_at?: string
          warning_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "resident_compliance_items_citation_topic_id_fkey"
            columns: ["citation_topic_id"]
            isOneToOne: false
            referencedRelation: "dhs_citation_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_compliance_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_compliance_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_compliance_items_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_documents: {
        Row: {
          compliance_item_id: string | null
          created_at: string
          document_label: string | null
          facility_id: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          organization_id: string
          resident_id: string
          storage_bucket: string
          storage_path: string
          uploaded_by_profile_id: string | null
        }
        Insert: {
          compliance_item_id?: string | null
          created_at?: string
          document_label?: string | null
          facility_id: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          organization_id: string
          resident_id: string
          storage_bucket?: string
          storage_path: string
          uploaded_by_profile_id?: string | null
        }
        Update: {
          compliance_item_id?: string | null
          created_at?: string
          document_label?: string | null
          facility_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          organization_id?: string
          resident_id?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_documents_compliance_item_id_fkey"
            columns: ["compliance_item_id"]
            isOneToOne: false
            referencedRelation: "resident_compliance_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      residents: {
        Row: {
          admission_date: string
          created_at: string
          discharge_date: string | null
          facility_id: string
          first_name: string
          hospice: boolean
          id: string
          last_name: string
          organization_id: string
          room: string | null
          sdcu: boolean
          status: string
          updated_at: string
        }
        Insert: {
          admission_date: string
          created_at?: string
          discharge_date?: string | null
          facility_id: string
          first_name: string
          hospice?: boolean
          id?: string
          last_name: string
          organization_id: string
          room?: string | null
          sdcu?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          admission_date?: string
          created_at?: string
          discharge_date?: string | null
          facility_id?: string
          first_name?: string
          hospice?: boolean
          id?: string
          last_name?: string
          organization_id?: string
          room?: string | null
          sdcu?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "residents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "residents_organization_id_fkey"
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
          checked_in_at: string | null
          checked_out_at: string | null
          checkin_method: string | null
          class_id: string
          created_at: string
          employee_id: string
          id: string
          training_record_id: string | null
        }
        Insert: {
          attended?: boolean
          checked_in_at?: string | null
          checked_out_at?: string | null
          checkin_method?: string | null
          class_id: string
          created_at?: string
          employee_id: string
          id?: string
          training_record_id?: string | null
        }
        Update: {
          attended?: boolean
          checked_in_at?: string | null
          checked_out_at?: string | null
          checkin_method?: string | null
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
          inspection_event_id: string | null
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
          inspection_event_id?: string | null
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
          inspection_event_id?: string | null
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
            foreignKeyName: "training_documents_inspection_event_id_fkey"
            columns: ["inspection_event_id"]
            isOneToOne: false
            referencedRelation: "inspection_events"
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
      training_plan_items: {
        Row: {
          course_id: string | null
          created_at: string
          id: string
          is_required: boolean
          sort_order: number
          training_plan_id: string
          training_type_id: string | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          sort_order?: number
          training_plan_id: string
          training_type_id?: string | null
        }
        Update: {
          course_id?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          sort_order?: number
          training_plan_id?: string
          training_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_plan_items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plan_items_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plan_items_training_type_id_fkey"
            columns: ["training_type_id"]
            isOneToOne: false
            referencedRelation: "training_types"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plans: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          citation_topic_id: string | null
          code: string
          created_at: string
          description: string | null
          document_required: boolean
          hour_bucket: string | null
          id: string
          is_active: boolean
          is_system_default: boolean
          name: string
          organization_id: string | null
          renewal_interval_days: number | null
          required_hours: number | null
          required_roles_text: string | null
          sort_order: number
          state: string
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
          citation_topic_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          document_required?: boolean
          hour_bucket?: string | null
          id?: string
          is_active?: boolean
          is_system_default?: boolean
          name: string
          organization_id?: string | null
          renewal_interval_days?: number | null
          required_hours?: number | null
          required_roles_text?: string | null
          sort_order?: number
          state?: string
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
          citation_topic_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          document_required?: boolean
          hour_bucket?: string | null
          id?: string
          is_active?: boolean
          is_system_default?: boolean
          name?: string
          organization_id?: string | null
          renewal_interval_days?: number | null
          required_hours?: number | null
          required_roles_text?: string | null
          sort_order?: number
          state?: string
          updated_at?: string
          warning_days_default?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_types_citation_topic_id_fkey"
            columns: ["citation_topic_id"]
            isOneToOne: false
            referencedRelation: "dhs_citation_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      violation_documents: {
        Row: {
          created_at: string
          document_label: string | null
          document_type: string
          facility_id: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          organization_id: string
          storage_bucket: string
          storage_path: string
          uploaded_by_profile_id: string | null
          violation_id: string
        }
        Insert: {
          created_at?: string
          document_label?: string | null
          document_type?: string
          facility_id: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          organization_id: string
          storage_bucket?: string
          storage_path: string
          uploaded_by_profile_id?: string | null
          violation_id: string
        }
        Update: {
          created_at?: string
          document_label?: string | null
          document_type?: string
          facility_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          organization_id?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_by_profile_id?: string | null
          violation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "violation_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "violation_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "violation_documents_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "violation_documents_violation_id_fkey"
            columns: ["violation_id"]
            isOneToOne: false
            referencedRelation: "dhs_violations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_update_profile: {
        Args: {
          p_email?: string
          p_first_name?: string
          p_is_active?: boolean
          p_last_name?: string
          p_organization_id?: string
          p_role?: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          email: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          organization_id: string | null
          phone: string | null
          role: string
          sms_consent_at: string | null
          sms_opt_in: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      checkin_via_kiosk_pin: {
        Args: { p_class_id: string; p_employee_id: string; p_pin: string }
        Returns: {
          attended: boolean
          checked_in_at: string | null
          checked_out_at: string | null
          checkin_method: string | null
          class_id: string
          created_at: string
          employee_id: string
          id: string
          training_record_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "training_class_attendees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      checkin_via_token: {
        Args: { p_token: string }
        Returns: {
          attended: boolean
          checked_in_at: string | null
          checked_out_at: string | null
          checkin_method: string | null
          class_id: string
          created_at: string
          employee_id: string
          id: string
          training_record_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "training_class_attendees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_course_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      complete_training_class: {
        Args: { p_class_id: string }
        Returns: undefined
      }
      course_version_is_published: {
        Args: { p_version_id: string }
        Returns: boolean
      }
      create_course_from_ai_draft: {
        Args: { p_draft: Json; p_generation_id: string }
        Returns: {
          course_id: string
          course_version_id: string
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      ensure_training_requirement_record: {
        Args: { p_employee_id: string; p_training_type_id: string }
        Returns: undefined
      }
      escalate_unactioned_alerts: { Args: never; Returns: undefined }
      generate_class_checkin_token: {
        Args: { p_class_id: string; p_long_lived?: boolean }
        Returns: string
      }
      get_facility_readiness_breakdown: {
        Args: { p_facility_id: string }
        Returns: {
          category: string
          chapter: string
          citation_ref: string
          citation_topic_id: string
          compliant_count: number
          frequency_weight: number
          title: string
          total_count: number
        }[]
      }
      get_quiz_answer_choices: {
        Args: { p_quiz_id: string }
        Returns: {
          answer_text: string
          id: string
          question_id: string
          sort_order: number
        }[]
      }
      get_quiz_review: {
        Args: { p_attempt_id: string }
        Returns: {
          answer_id: string
          answer_text: string
          explanation: string
          is_correct: boolean
          question_id: string
        }[]
      }
      grade_quiz_attempt: { Args: { p_attempt_id: string }; Returns: undefined }
      instantiate_employee_onboarding_checklist: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      instantiate_missing_requirements: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      instantiate_resident_compliance_items: {
        Args: { p_resident_id: string }
        Returns: undefined
      }
      is_assigned_to_facility: {
        Args: { target_facility_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      issue_certificate: {
        Args: {
          p_course_assignment_id?: string
          p_course_id: string
          p_employee_id: string
          p_expires_at?: string
        }
        Returns: string
      }
      log_document_access: {
        Args: { p_document_id: string; p_document_table: string }
        Returns: undefined
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      match_exclusion_list_against_roster_core: {
        Args: { p_organization_id?: string; p_source: string }
        Returns: undefined
      }
      owns_employee: { Args: { p_employee_id: string }; Returns: boolean }
      queue_course_continuation_reminders: { Args: never; Returns: undefined }
      recalculate_all_compliance: { Args: never; Returns: undefined }
      recalculate_compliance_core: {
        Args: { p_organization_id?: string }
        Returns: undefined
      }
      recalculate_course_assignment_statuses: {
        Args: never
        Returns: undefined
      }
      recalculate_incident_notifications: { Args: never; Returns: undefined }
      recalculate_org_compliance: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      recalculate_resident_compliance_statuses: {
        Args: never
        Returns: undefined
      }
      replace_quiz_questions: {
        Args: { p_questions: Json; p_quiz_id: string }
        Returns: undefined
      }
      rescan_org_exclusion_matches: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      send_monday_digest: { Args: never; Returns: undefined }
      send_policy_attestation_reminders: { Args: never; Returns: undefined }
      set_certificate_pdf: {
        Args: { p_bucket: string; p_certificate_id: string; p_path: string }
        Returns: {
          course_assignment_id: string | null
          course_id: string
          created_at: string
          employee_id: string
          expires_at: string | null
          facility_id: string
          id: string
          issued_at: string
          organization_id: string
          pdf_storage_bucket: string | null
          pdf_storage_path: string | null
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "certificates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_employee_checkin_pin: {
        Args: { p_employee_id: string; p_pin: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_course_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      verify_certificate: {
        Args: { p_slug: string }
        Returns: {
          course_title: string
          employee_name: string
          expires_at: string
          is_valid: boolean
          issued_at: string
          organization_name: string
        }[]
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
