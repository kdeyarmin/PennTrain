export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          resident_compliance_item_id: string | null
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
          resident_compliance_item_id?: string | null
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
          resident_compliance_item_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          training_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_resident_compliance_item_id_fkey"
            columns: ["resident_compliance_item_id"]
            isOneToOne: false
            referencedRelation: "resident_compliance_items"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "alerts_resident_compliance_item_id_fkey"
            columns: ["resident_compliance_item_id"]
            isOneToOne: false
            referencedRelation: "resident_compliance_items"
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
      assessor_qualifications: {
        Row: {
          approved_by: string
          assessor_profile_id: string
          certification_definition_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          evidence: Json
          id: string
          organization_id: string
        }
        Insert: {
          approved_by: string
          assessor_profile_id: string
          certification_definition_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          evidence?: Json
          id?: string
          organization_id: string
        }
        Update: {
          approved_by?: string
          assessor_profile_id?: string
          certification_definition_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          evidence?: Json
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessor_qualifications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessor_qualifications_assessor_profile_id_fkey"
            columns: ["assessor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessor_qualifications_certification_definition_id_fkey"
            columns: ["certification_definition_id"]
            isOneToOne: false
            referencedRelation: "certification_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessor_qualifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          actor_subject_id: string | null
          correlation_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          event_hash: string
          facility_id: string | null
          hash_version: number
          id: string
          ip_address: string | null
          metadata: Json
          new_values: Json | null
          old_values: Json | null
          organization_id: string | null
          reason: string | null
          request_id: string
          source: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          actor_subject_id?: string | null
          correlation_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_hash: string
          facility_id?: string | null
          hash_version?: number
          id?: string
          ip_address?: string | null
          metadata?: Json
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          reason?: string | null
          request_id: string
          source: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          actor_subject_id?: string | null
          correlation_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_hash?: string
          facility_id?: string | null
          hash_version?: number
          id?: string
          ip_address?: string | null
          metadata?: Json
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          reason?: string | null
          request_id?: string
          source?: string
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
      billing_accounts: {
        Row: {
          billing_state: string
          comped_until: string | null
          created_at: string
          grace_ends_at: string | null
          id: string
          organization_id: string
          provider_event_created_at: string | null
          provider_event_id: string | null
          provider_state: string | null
          state_source: string
          stripe_customer_id: string | null
          suspension_reason: string | null
          updated_at: string
        }
        Insert: {
          billing_state?: string
          comped_until?: string | null
          created_at?: string
          grace_ends_at?: string | null
          id?: string
          organization_id: string
          provider_event_created_at?: string | null
          provider_event_id?: string | null
          provider_state?: string | null
          state_source?: string
          stripe_customer_id?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Update: {
          billing_state?: string
          comped_until?: string | null
          created_at?: string
          grace_ends_at?: string | null
          id?: string
          organization_id?: string
          provider_event_created_at?: string | null
          provider_event_id?: string | null
          provider_state?: string | null
          state_source?: string
          stripe_customer_id?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          amount_remaining: number
          created_at: string
          currency: string
          due_at: string | null
          hosted_invoice_url: string | null
          id: string
          issued_at: string | null
          organization_id: string
          paid_at: string | null
          provider_event_created_at: string
          provider_event_id: string
          provider_status: string
          stripe_invoice_id: string
          stripe_subscription_id: string | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          hosted_invoice_url?: string | null
          id?: string
          issued_at?: string | null
          organization_id: string
          paid_at?: string | null
          provider_event_created_at: string
          provider_event_id: string
          provider_status: string
          stripe_invoice_id: string
          stripe_subscription_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          hosted_invoice_url?: string | null
          id?: string
          issued_at?: string | null
          organization_id?: string
          paid_at?: string | null
          provider_event_created_at?: string
          provider_event_id?: string
          provider_status?: string
          stripe_invoice_id?: string
          stripe_subscription_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_subscription_id_organization_id_fkey"
            columns: ["subscription_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "billing_subscriptions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      billing_subscription_items: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          quantity: number
          stripe_price_id: string
          stripe_subscription_item_id: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          quantity?: number
          stripe_price_id: string
          stripe_subscription_item_id: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          quantity?: number
          stripe_price_id?: string
          stripe_subscription_item_id?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscription_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscription_items_subscription_id_organization_id_fkey"
            columns: ["subscription_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "billing_subscriptions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      billing_subscriptions: {
        Row: {
          billing_account_id: string
          billing_state: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          organization_id: string
          package_id: string | null
          provider_event_created_at: string
          provider_event_id: string
          provider_status: string
          seat_quantity: number
          stripe_subscription_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_account_id: string
          billing_state: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id: string
          package_id?: string | null
          provider_event_created_at: string
          provider_event_id: string
          provider_status: string
          seat_quantity?: number
          stripe_subscription_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_account_id?: string
          billing_state?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id?: string
          package_id?: string | null
          provider_event_created_at?: string
          provider_event_id?: string
          provider_status?: string
          seat_quantity?: number
          stripe_subscription_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscriptions_billing_account_id_fkey"
            columns: ["billing_account_id"]
            isOneToOne: false
            referencedRelation: "billing_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_lifecycle_events: {
        Row: {
          certificate_id: string
          correlation_id: string
          course_assignment_id: string | null
          created_at: string
          delivery_attempt_count: number
          delivery_status: string
          event_type: string
          id: string
          idempotency_key: string
          last_delivery_attempt_at: string | null
          last_error: string | null
          organization_id: string
          payload: Json
          published_at: string | null
          updated_at: string
        }
        Insert: {
          certificate_id: string
          correlation_id: string
          course_assignment_id?: string | null
          created_at?: string
          delivery_attempt_count?: number
          delivery_status?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_delivery_attempt_at?: string | null
          last_error?: string | null
          organization_id: string
          payload?: Json
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          certificate_id?: string
          correlation_id?: string
          course_assignment_id?: string | null
          created_at?: string
          delivery_attempt_count?: number
          delivery_status?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_delivery_attempt_at?: string | null
          last_error?: string | null
          organization_id?: string
          payload?: Json
          published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificate_lifecycle_events_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_lifecycle_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_pdf_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          certificate_id: string
          completed_at: string | null
          correlation_id: string
          created_at: string
          current_run_id: string | null
          id: string
          job_key: string
          last_error_code: string | null
          last_error_message: string | null
          last_started_at: string | null
          locked_at: string | null
          max_attempts: number
          organization_id: string
          requested_at: string
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          certificate_id: string
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          current_run_id?: string | null
          id?: string
          job_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_started_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          organization_id: string
          requested_at?: string
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number
          available_at?: string
          certificate_id?: string
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          current_run_id?: string | null
          id?: string
          job_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_started_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          organization_id?: string
          requested_at?: string
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_pdf_jobs_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: true
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_pdf_jobs_organization_id_fkey"
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
          credential_number: string
          employee_id: string
          expires_at: string | null
          facility_id: string
          id: string
          issued_at: string
          organization_id: string
          pdf_attempt_count: number
          pdf_last_attempt_at: string | null
          pdf_last_error: string | null
          pdf_ready_at: string | null
          pdf_status: string
          pdf_storage_bucket: string | null
          pdf_storage_path: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          course_assignment_id?: string | null
          course_id: string
          created_at?: string
          credential_number?: string
          employee_id: string
          expires_at?: string | null
          facility_id: string
          id?: string
          issued_at?: string
          organization_id: string
          pdf_attempt_count?: number
          pdf_last_attempt_at?: string | null
          pdf_last_error?: string | null
          pdf_ready_at?: string | null
          pdf_status?: string
          pdf_storage_bucket?: string | null
          pdf_storage_path?: string | null
          slug?: string
          updated_at?: string
        }
        Update: {
          course_assignment_id?: string | null
          course_id?: string
          created_at?: string
          credential_number?: string
          employee_id?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          issued_at?: string
          organization_id?: string
          pdf_attempt_count?: number
          pdf_last_attempt_at?: string | null
          pdf_last_error?: string | null
          pdf_ready_at?: string | null
          pdf_status?: string
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
      certification_attempt_items: {
        Row: {
          certification_attempt_id: string
          checklist_item_id: string
          created_at: string
          evidence: Json
          evidence_checksum_sha256: string | null
          id: string
          notes: string | null
          result: string
          signed_at: string | null
        }
        Insert: {
          certification_attempt_id: string
          checklist_item_id: string
          created_at?: string
          evidence?: Json
          evidence_checksum_sha256?: string | null
          id?: string
          notes?: string | null
          result: string
          signed_at?: string | null
        }
        Update: {
          certification_attempt_id?: string
          checklist_item_id?: string
          created_at?: string
          evidence?: Json
          evidence_checksum_sha256?: string | null
          id?: string
          notes?: string | null
          result?: string
          signed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certification_attempt_items_certification_attempt_id_fkey"
            columns: ["certification_attempt_id"]
            isOneToOne: false
            referencedRelation: "certification_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempt_items_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "certification_checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      certification_attempts: {
        Row: {
          assessor_profile_id: string
          assessor_signature_sha256: string | null
          certification_version_id: string
          created_at: string
          created_by: string
          decided_at: string | null
          decision_reason: string | null
          employee_id: string
          evidence_checksum_sha256: string | null
          facility_id: string
          id: string
          observed_at: string
          organization_id: string
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          assessor_profile_id: string
          assessor_signature_sha256?: string | null
          certification_version_id: string
          created_at?: string
          created_by: string
          decided_at?: string | null
          decision_reason?: string | null
          employee_id: string
          evidence_checksum_sha256?: string | null
          facility_id: string
          id?: string
          observed_at?: string
          organization_id: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          assessor_profile_id?: string
          assessor_signature_sha256?: string | null
          certification_version_id?: string
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decision_reason?: string | null
          employee_id?: string
          evidence_checksum_sha256?: string | null
          facility_id?: string
          id?: string
          observed_at?: string
          organization_id?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certification_attempts_assessor_profile_id_fkey"
            columns: ["assessor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempts_certification_version_id_fkey"
            columns: ["certification_version_id"]
            isOneToOne: false
            referencedRelation: "certification_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      certification_checklist_items: {
        Row: {
          certification_version_id: string
          evidence_required: boolean
          id: string
          item_key: string
          prompt: string
          signature_required: boolean
          sort_order: number
        }
        Insert: {
          certification_version_id: string
          evidence_required?: boolean
          id?: string
          item_key: string
          prompt: string
          signature_required?: boolean
          sort_order?: number
        }
        Update: {
          certification_version_id?: string
          evidence_required?: boolean
          id?: string
          item_key?: string
          prompt?: string
          signature_required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "certification_checklist_items_certification_version_id_fkey"
            columns: ["certification_version_id"]
            isOneToOne: false
            referencedRelation: "certification_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      certification_definition_versions: {
        Row: {
          authored_by: string
          certification_definition_id: string
          created_at: string
          criteria: Json
          criteria_checksum_sha256: string
          effective_from: string | null
          effective_to: string | null
          id: string
          lifecycle_state: string
          published_at: string | null
          published_by: string | null
          version_number: number
        }
        Insert: {
          authored_by: string
          certification_definition_id: string
          created_at?: string
          criteria?: Json
          criteria_checksum_sha256: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          lifecycle_state?: string
          published_at?: string | null
          published_by?: string | null
          version_number: number
        }
        Update: {
          authored_by?: string
          certification_definition_id?: string
          created_at?: string
          criteria?: Json
          criteria_checksum_sha256?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          lifecycle_state?: string
          published_at?: string | null
          published_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "certification_definition_versi_certification_definition_id_fkey"
            columns: ["certification_definition_id"]
            isOneToOne: false
            referencedRelation: "certification_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_definition_versions_authored_by_fkey"
            columns: ["authored_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_definition_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certification_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          default_validity_days: number | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          qualification_key: string
          renewal_window_days: number
          separation_of_duties: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_validity_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          qualification_key: string
          renewal_window_days?: number
          separation_of_duties?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_validity_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          qualification_key?: string
          renewal_window_days?: number
          separation_of_duties?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certification_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_definitions_organization_id_fkey"
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
      compliance_profile_definitions: {
        Row: {
          code: string
          created_at: string
          description: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          is_mandatory_baseline: boolean
          is_system_managed: boolean
          name: string
          organization_id: string | null
          profile_kind: string
          updated_at: string
          version: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          is_mandatory_baseline?: boolean
          is_system_managed?: boolean
          name: string
          organization_id?: string | null
          profile_kind?: string
          updated_at?: string
          version?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          is_mandatory_baseline?: boolean
          is_system_managed?: boolean
          name?: string
          organization_id?: string | null
          profile_kind?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "compliance_profile_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_profile_mapping_rules: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          facility_type: string | null
          id: string
          is_active: boolean
          job_title_pattern: string | null
          name: string
          organization_id: string
          priority: number
          profile_definition_id: string
          updated_at: string
          worker_type: string | null
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          facility_type?: string | null
          id?: string
          is_active?: boolean
          job_title_pattern?: string | null
          name: string
          organization_id: string
          priority?: number
          profile_definition_id: string
          updated_at?: string
          worker_type?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          facility_type?: string | null
          id?: string
          is_active?: boolean
          job_title_pattern?: string | null
          name?: string
          organization_id?: string
          priority?: number
          profile_definition_id?: string
          updated_at?: string
          worker_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_profile_mapping_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_profile_mapping_rules_profile_definition_id_fkey"
            columns: ["profile_definition_id"]
            isOneToOne: false
            referencedRelation: "compliance_profile_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_profile_requirements: {
        Row: {
          created_at: string
          evidence_required: boolean
          id: string
          is_mandatory: boolean
          label: string
          minimum_hours: number
          profile_definition_id: string
          renewal_days: number | null
          requirement_key: string
          rule: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence_required?: boolean
          id?: string
          is_mandatory?: boolean
          label: string
          minimum_hours?: number
          profile_definition_id: string
          renewal_days?: number | null
          requirement_key: string
          rule?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence_required?: boolean
          id?: string
          is_mandatory?: boolean
          label?: string
          minimum_hours?: number
          profile_definition_id?: string
          renewal_days?: number | null
          requirement_key?: string
          rule?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_profile_requirements_profile_definition_id_fkey"
            columns: ["profile_definition_id"]
            isOneToOne: false
            referencedRelation: "compliance_profile_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_profile_resolution_exceptions: {
        Row: {
          created_at: string
          details: Json
          employee_id: string
          exception_code: string
          facility_id: string
          id: string
          organization_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          employee_id: string
          exception_code: string
          facility_id: string
          id?: string
          organization_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          employee_id?: string
          exception_code?: string
          facility_id?: string
          id?: string
          organization_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_profile_resolution_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_profile_resolution_exceptions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_profile_resolution_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_profile_resolution_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_incident_access_events: {
        Row: {
          actor_profile_id: string | null
          event_type: string
          facility_id: string
          id: string
          intake_id: string
          occurred_at: string
          organization_id: string
          purpose: string
        }
        Insert: {
          actor_profile_id?: string | null
          event_type: string
          facility_id: string
          id?: string
          intake_id: string
          occurred_at?: string
          organization_id: string
          purpose: string
        }
        Update: {
          actor_profile_id?: string | null
          event_type?: string
          facility_id?: string
          id?: string
          intake_id?: string
          occurred_at?: string
          organization_id?: string
          purpose?: string
        }
        Relationships: [
          {
            foreignKeyName: "confidential_incident_access_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_access_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_access_events_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "confidential_incident_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_access_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_incident_details: {
        Row: {
          created_at: string
          id: string
          intake_id: string
          investigation_findings: string | null
          location_detail: string | null
          narrative: string
          organization_id: string
          regulatory_deadline_at: string | null
          resident_id: string | null
          root_cause: string | null
          updated_at: string
          witness_data: Json
        }
        Insert: {
          created_at?: string
          id?: string
          intake_id: string
          investigation_findings?: string | null
          location_detail?: string | null
          narrative: string
          organization_id: string
          regulatory_deadline_at?: string | null
          resident_id?: string | null
          root_cause?: string | null
          updated_at?: string
          witness_data?: Json
        }
        Update: {
          created_at?: string
          id?: string
          intake_id?: string
          investigation_findings?: string | null
          location_detail?: string | null
          narrative?: string
          organization_id?: string
          regulatory_deadline_at?: string | null
          resident_id?: string | null
          root_cause?: string | null
          updated_at?: string
          witness_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "confidential_incident_details_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: true
            referencedRelation: "confidential_incident_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_details_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_incident_intakes: {
        Row: {
          confirmation_token_sha256: string
          created_at: string
          facility_id: string
          id: string
          immediate_danger: boolean
          intake_number: string
          occurred_at: string | null
          organization_id: string
          public_summary: string
          report_type: string
          reported_at: string
          reporter_mode: string
          resume_secret_sha256: string
          retention_until: string | null
          severity: string
          status: string
          triage_work_item_id: string | null
          updated_at: string
        }
        Insert: {
          confirmation_token_sha256: string
          created_at?: string
          facility_id: string
          id?: string
          immediate_danger?: boolean
          intake_number?: string
          occurred_at?: string | null
          organization_id: string
          public_summary: string
          report_type: string
          reported_at?: string
          reporter_mode: string
          resume_secret_sha256: string
          retention_until?: string | null
          severity: string
          status?: string
          triage_work_item_id?: string | null
          updated_at?: string
        }
        Update: {
          confirmation_token_sha256?: string
          created_at?: string
          facility_id?: string
          id?: string
          immediate_danger?: boolean
          intake_number?: string
          occurred_at?: string | null
          organization_id?: string
          public_summary?: string
          report_type?: string
          reported_at?: string
          reporter_mode?: string
          resume_secret_sha256?: string
          retention_until?: string | null
          severity?: string
          status?: string
          triage_work_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confidential_incident_intakes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_intakes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_incident_intakes_triage_work_item_id_fkey"
            columns: ["triage_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_intake_attempts: {
        Row: {
          created_at: string
          error_code: string | null
          facility_id: string | null
          id: number
          ip_hash: string
          success: boolean
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          facility_id?: string | null
          id?: never
          ip_hash: string
          success: boolean
        }
        Update: {
          created_at?: string
          error_code?: string | null
          facility_id?: string | null
          id?: never
          ip_hash?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "confidential_intake_attempts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_reporter_identities: {
        Row: {
          consent_to_contact: boolean
          created_at: string
          encrypted_contact: Json
          id: string
          intake_id: string
          organization_id: string
          reporter_profile_id: string | null
        }
        Insert: {
          consent_to_contact?: boolean
          created_at?: string
          encrypted_contact?: Json
          id?: string
          intake_id: string
          organization_id: string
          reporter_profile_id?: string | null
        }
        Update: {
          consent_to_contact?: boolean
          created_at?: string
          encrypted_contact?: Json
          id?: string
          intake_id?: string
          organization_id?: string
          reporter_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confidential_reporter_identities_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: true
            referencedRelation: "confidential_incident_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_reporter_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_reporter_identities_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          canceled_at: string | null
          cancellation_reason: string | null
          completed_at: string | null
          course_id: string
          course_version_id: string
          due_date: string | null
          employee_id: string
          facility_id: string
          id: string
          lifecycle_disposition: string | null
          lifecycle_event_id: string | null
          lifecycle_previous_status: string | null
          organization_id: string
          status: string
          training_plan_id: string | null
          training_plan_item_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          course_id: string
          course_version_id: string
          due_date?: string | null
          employee_id: string
          facility_id: string
          id?: string
          lifecycle_disposition?: string | null
          lifecycle_event_id?: string | null
          lifecycle_previous_status?: string | null
          organization_id: string
          status?: string
          training_plan_id?: string | null
          training_plan_item_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          course_id?: string
          course_version_id?: string
          due_date?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          lifecycle_disposition?: string | null
          lifecycle_event_id?: string | null
          lifecycle_previous_status?: string | null
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
            foreignKeyName: "course_assignments_lifecycle_event_id_fkey"
            columns: ["lifecycle_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
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
      credential_renewal_submissions: {
        Row: {
          approved_credential_id: string | null
          created_at: string
          credential_document_id: string
          credential_id: string | null
          credential_type: string
          employee_id: string
          extracted_fields: Json
          extraction_confidence: Json
          extraction_model: string | null
          extraction_provider: string | null
          facility_id: string
          human_confirmed_fields: Json
          id: string
          organization_id: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan_evidence: Json
          scan_provider: string | null
          scan_status: string
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          approved_credential_id?: string | null
          created_at?: string
          credential_document_id: string
          credential_id?: string | null
          credential_type: string
          employee_id: string
          extracted_fields?: Json
          extraction_confidence?: Json
          extraction_model?: string | null
          extraction_provider?: string | null
          facility_id: string
          human_confirmed_fields?: Json
          id?: string
          organization_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_evidence?: Json
          scan_provider?: string | null
          scan_status?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_credential_id?: string | null
          created_at?: string
          credential_document_id?: string
          credential_id?: string | null
          credential_type?: string
          employee_id?: string
          extracted_fields?: Json
          extraction_confidence?: Json
          extraction_model?: string | null
          extraction_provider?: string | null
          facility_id?: string
          human_confirmed_fields?: Json
          id?: string
          organization_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_evidence?: Json
          scan_provider?: string | null
          scan_status?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_renewal_submissions_approved_credential_id_fkey"
            columns: ["approved_credential_id"]
            isOneToOne: false
            referencedRelation: "employee_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_credential_document_id_fkey"
            columns: ["credential_document_id"]
            isOneToOne: false
            referencedRelation: "employee_credential_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "employee_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_renewal_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          source_inspection_event_id: string | null
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
          source_inspection_event_id?: string | null
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
          source_inspection_event_id?: string | null
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
            foreignKeyName: "dhs_violations_source_inspection_event_id_fkey"
            columns: ["source_inspection_event_id"]
            isOneToOne: false
            referencedRelation: "inspection_events"
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
      employee_access_suspensions: {
        Row: {
          created_at: string
          created_by_event_id: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          profile_id: string
          profile_was_active: boolean
          reason: string
          released_by_event_id: string | null
          suspension_type: string
        }
        Insert: {
          created_at?: string
          created_by_event_id: string
          effective_from: string
          effective_to?: string | null
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          profile_id: string
          profile_was_active: boolean
          reason: string
          released_by_event_id?: string | null
          suspension_type: string
        }
        Update: {
          created_at?: string
          created_by_event_id?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          profile_id?: string
          profile_was_active?: boolean
          reason?: string
          released_by_event_id?: string | null
          suspension_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_access_suspensions_created_by_event_id_fkey"
            columns: ["created_by_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_access_suspensions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_access_suspensions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_access_suspensions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_access_suspensions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_access_suspensions_released_by_event_id_fkey"
            columns: ["released_by_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_availability_windows: {
        Row: {
          availability_type: string
          created_at: string
          created_by: string | null
          employee_id: string
          ends_at: string
          facility_id: string
          id: string
          organization_id: string
          reason: string | null
          recurrence_rule: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          availability_type: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          ends_at: string
          facility_id: string
          id?: string
          organization_id: string
          reason?: string | null
          recurrence_rule?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          availability_type?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          ends_at?: string
          facility_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          recurrence_rule?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_windows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_windows_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_windows_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_windows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      employee_compliance_profile_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          profile_definition_id: string
          reason: string
          source: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          profile_definition_id: string
          reason?: string
          source?: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          profile_definition_id?: string
          reason?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_compliance_profile_assignme_profile_definition_id_fkey"
            columns: ["profile_definition_id"]
            isOneToOne: false
            referencedRelation: "compliance_profile_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compliance_profile_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compliance_profile_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compliance_profile_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compliance_profile_assignments_organization_id_fkey"
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
      employee_facility_assignments: {
        Row: {
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          is_primary: boolean
          organization_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          is_primary?: boolean
          organization_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_facility_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_facility_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_facility_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      employee_qualifications: {
        Row: {
          approved_by: string
          certification_definition_id: string
          certification_version_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          expires_at: string | null
          facility_id: string
          id: string
          issued_at: string
          organization_id: string
          renewal_window_opens_at: string | null
          source_attempt_id: string | null
          state: string
          state_reason: string | null
          updated_at: string
        }
        Insert: {
          approved_by: string
          certification_definition_id: string
          certification_version_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          employee_id: string
          expires_at?: string | null
          facility_id: string
          id?: string
          issued_at: string
          organization_id: string
          renewal_window_opens_at?: string | null
          source_attempt_id?: string | null
          state: string
          state_reason?: string | null
          updated_at?: string
        }
        Update: {
          approved_by?: string
          certification_definition_id?: string
          certification_version_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          issued_at?: string
          organization_id?: string
          renewal_window_opens_at?: string | null
          source_attempt_id?: string | null
          state?: string
          state_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_qualifications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_certification_definition_id_fkey"
            columns: ["certification_definition_id"]
            isOneToOne: false
            referencedRelation: "certification_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_certification_version_id_fkey"
            columns: ["certification_version_id"]
            isOneToOne: false
            referencedRelation: "certification_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_qualifications_source_attempt_id_fkey"
            columns: ["source_attempt_id"]
            isOneToOne: false
            referencedRelation: "certification_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_schedule_preferences: {
        Row: {
          created_at: string
          days_of_week: number[]
          employee_id: string
          facility_id: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          priority: number
          shift_definition_id: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_of_week: number[]
          employee_id: string
          facility_id: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          priority?: number
          shift_definition_id: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          employee_id?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          priority?: number
          shift_definition_id?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_schedule_preferences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_schedule_preferences_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_schedule_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_schedule_preferences_shift_definition_id_fkey"
            columns: ["shift_definition_id"]
            isOneToOne: false
            referencedRelation: "shift_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_schedule_preferences_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "facility_units"
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
      employment_episodes: {
        Row: {
          created_at: string
          employee_id: string
          end_reason: string | null
          ended_on: string | null
          episode_status: string
          facility_id: string
          id: string
          organization_id: string
          person_id: string
          previous_episode_id: string | null
          source: string
          start_reason: string
          started_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_reason?: string | null
          ended_on?: string | null
          episode_status?: string
          facility_id: string
          id?: string
          organization_id: string
          person_id: string
          previous_episode_id?: string | null
          source?: string
          start_reason?: string
          started_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_reason?: string | null
          ended_on?: string | null
          episode_status?: string
          facility_id?: string
          id?: string
          organization_id?: string
          person_id?: string
          previous_episode_id?: string | null
          source?: string
          start_reason?: string
          started_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_episodes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_episodes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_episodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_episodes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "workforce_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_episodes_previous_episode_id_fkey"
            columns: ["previous_episode_id"]
            isOneToOne: false
            referencedRelation: "employment_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_lifecycle_dispositions: {
        Row: {
          created_at: string
          disposition_action: string
          employee_id: string
          facility_id: string | null
          id: string
          lifecycle_event_id: string
          organization_id: string
          policy_version: string
          prior_state: Json
          resulting_state: Json
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          disposition_action: string
          employee_id: string
          facility_id?: string | null
          id?: string
          lifecycle_event_id: string
          organization_id: string
          policy_version?: string
          prior_state: Json
          resulting_state: Json
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          disposition_action?: string
          employee_id?: string
          facility_id?: string | null
          id?: string
          lifecycle_event_id?: string
          organization_id?: string
          policy_version?: string
          prior_state?: Json
          resulting_state?: Json
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_lifecycle_dispositions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_dispositions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_dispositions_lifecycle_event_id_fkey"
            columns: ["lifecycle_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_dispositions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_lifecycle_events: {
        Row: {
          actor_profile_id: string | null
          correlation_id: string
          created_at: string
          effective_on: string
          employee_id: string
          employment_episode_id: string | null
          event_type: string
          evidence: Json
          facility_id: string
          from_status: string | null
          id: string
          organization_id: string
          person_id: string
          reason: string
          to_status: string | null
        }
        Insert: {
          actor_profile_id?: string | null
          correlation_id?: string
          created_at?: string
          effective_on: string
          employee_id: string
          employment_episode_id?: string | null
          event_type: string
          evidence?: Json
          facility_id: string
          from_status?: string | null
          id?: string
          organization_id: string
          person_id: string
          reason: string
          to_status?: string | null
        }
        Update: {
          actor_profile_id?: string | null
          correlation_id?: string
          created_at?: string
          effective_on?: string
          employee_id?: string
          employment_episode_id?: string | null
          event_type?: string
          evidence?: Json
          facility_id?: string
          from_status?: string | null
          id?: string
          organization_id?: string
          person_id?: string
          reason?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employment_lifecycle_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_events_employment_episode_id_fkey"
            columns: ["employment_episode_id"]
            isOneToOne: false
            referencedRelation: "employment_episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_lifecycle_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "workforce_people"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_access_grants: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          granted_by: string | null
          id: string
          membership_id: string
          reason: string
          role_template_id: string
          source: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by?: string | null
          id?: string
          membership_id: string
          reason?: string
          role_template_id: string
          source?: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by?: string | null
          id?: string
          membership_id?: string
          reason?: string
          role_template_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_access_grants_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "enterprise_scope_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_access_grants_role_template_id_fkey"
            columns: ["role_template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_organization_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          organization_id: string
          portfolio_id: string
          reason: string | null
          region_id: string
          source: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id: string
          portfolio_id: string
          reason?: string | null
          region_id: string
          source?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id?: string
          portfolio_id?: string
          reason?: string | null
          region_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_org_membership_region_fk"
            columns: ["region_id", "portfolio_id"]
            isOneToOne: false
            referencedRelation: "enterprise_regions"
            referencedColumns: ["id", "portfolio_id"]
          },
          {
            foreignKeyName: "enterprise_organization_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_organization_memberships_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "enterprise_portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_portfolios: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      enterprise_regions: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          portfolio_id: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          portfolio_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          portfolio_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_regions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "enterprise_portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_scope_backfill_exceptions: {
        Row: {
          created_at: string
          details: Json
          exception_code: string
          id: string
          organization_id: string | null
          profile_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          exception_code: string
          id?: string
          organization_id?: string | null
          profile_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          exception_code?: string
          id?: string
          organization_id?: string | null
          profile_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_scope_backfill_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_backfill_exceptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_backfill_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_scope_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          facility_id: string | null
          id: string
          legacy_role: string | null
          organization_id: string | null
          portfolio_id: string | null
          profile_id: string
          reason: string | null
          region_id: string | null
          scope_type: string
          source: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          facility_id?: string | null
          id?: string
          legacy_role?: string | null
          organization_id?: string | null
          portfolio_id?: string | null
          profile_id: string
          reason?: string | null
          region_id?: string | null
          scope_type: string
          source?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          facility_id?: string | null
          id?: string
          legacy_role?: string | null
          organization_id?: string | null
          portfolio_id?: string | null
          profile_id?: string
          reason?: string | null
          region_id?: string | null
          scope_type?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_scope_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_memberships_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_memberships_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "enterprise_portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_scope_memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "enterprise_regions"
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
          item_types: string[] | null
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
          item_types?: string[] | null
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
          item_types?: string[] | null
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
      evidence_collection_artifacts: {
        Row: {
          added_at: string
          added_by: string | null
          artifact_scope: Json
          collection_id: string
          display_name: string
          facility_id: string
          id: string
          organization_id: string
          snapshot_artifact_id: string
          withdrawn_at: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          artifact_scope?: Json
          collection_id: string
          display_name: string
          facility_id: string
          id?: string
          organization_id: string
          snapshot_artifact_id: string
          withdrawn_at?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          artifact_scope?: Json
          collection_id?: string
          display_name?: string
          facility_id?: string
          id?: string
          organization_id?: string
          snapshot_artifact_id?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_collection_artifacts_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collection_artifacts_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "evidence_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collection_artifacts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collection_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collection_artifacts_snapshot_artifact_id_fkey"
            columns: ["snapshot_artifact_id"]
            isOneToOne: false
            referencedRelation: "report_snapshot_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_collections: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string
          id: string
          legal_hold: boolean
          name: string
          organization_id: string
          published_at: string | null
          purpose: string
          status: string
          terms_version: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id: string
          id?: string
          legal_hold?: boolean
          name: string
          organization_id: string
          published_at?: string | null
          purpose: string
          status?: string
          terms_version: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          legal_hold?: boolean
          name?: string
          organization_id?: string
          published_at?: string | null
          purpose?: string
          status?: string
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_collections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_guest_access_events: {
        Row: {
          artifact_id: string | null
          collection_id: string
          event_type: string
          facility_id: string
          guest_grant_id: string | null
          id: string
          occurred_at: string
          organization_id: string
          reason: string
          request_fingerprint_sha256: string | null
        }
        Insert: {
          artifact_id?: string | null
          collection_id: string
          event_type: string
          facility_id: string
          guest_grant_id?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          reason: string
          request_fingerprint_sha256?: string | null
        }
        Update: {
          artifact_id?: string | null
          collection_id?: string
          event_type?: string
          facility_id?: string
          guest_grant_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          reason?: string
          request_fingerprint_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_guest_access_events_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "evidence_collection_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_access_events_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "evidence_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_access_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_access_events_guest_grant_id_fkey"
            columns: ["guest_grant_id"]
            isOneToOne: false
            referencedRelation: "evidence_guest_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_access_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_guest_comments: {
        Row: {
          artifact_id: string | null
          body: string
          collection_id: string
          created_at: string
          facility_id: string
          guest_grant_id: string
          id: string
          organization_id: string
        }
        Insert: {
          artifact_id?: string | null
          body: string
          collection_id: string
          created_at?: string
          facility_id: string
          guest_grant_id: string
          id?: string
          organization_id: string
        }
        Update: {
          artifact_id?: string | null
          body?: string
          collection_id?: string
          created_at?: string
          facility_id?: string
          guest_grant_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_guest_comments_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "evidence_collection_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_comments_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "evidence_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_comments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_comments_guest_grant_id_fkey"
            columns: ["guest_grant_id"]
            isOneToOne: false
            referencedRelation: "evidence_guest_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_guest_grants: {
        Row: {
          accepted_at: string | null
          allowed_artifact_ids: string[]
          collection_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          facility_id: string
          guest_email_hash: string | null
          guest_label: string
          id: string
          last_reviewed_at: string | null
          organization_id: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          step_up_required: boolean
          step_up_verified_at: string | null
          terms_version: string
          token_sha256: string
        }
        Insert: {
          accepted_at?: string | null
          allowed_artifact_ids: string[]
          collection_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          facility_id: string
          guest_email_hash?: string | null
          guest_label: string
          id?: string
          last_reviewed_at?: string | null
          organization_id: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          step_up_required?: boolean
          step_up_verified_at?: string | null
          terms_version: string
          token_sha256: string
        }
        Update: {
          accepted_at?: string | null
          allowed_artifact_ids?: string[]
          collection_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          facility_id?: string
          guest_email_hash?: string | null
          guest_label?: string
          id?: string
          last_reviewed_at?: string | null
          organization_id?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          step_up_required?: boolean
          step_up_verified_at?: string | null
          terms_version?: string
          token_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_guest_grants_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "evidence_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_grants_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_guest_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          snapshot_id: string
          source: string
          source_record_key: string
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
          snapshot_id: string
          source: string
          source_record_key: string
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
          snapshot_id?: string
          source?: string
          source_record_key?: string
          upin?: string | null
          waiver_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_list_entries_snapshot_source_fkey"
            columns: ["snapshot_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_source_snapshots"
            referencedColumns: ["id", "source"]
          },
        ]
      }
      exclusion_refresh_runs: {
        Row: {
          activated_snapshot_id: string | null
          checksum: string | null
          completed_at: string | null
          correlation_id: string
          error: string | null
          expected_record_count: number | null
          id: string
          snapshot_id: string
          source: string
          staged_record_count: number
          started_at: string
          status: string
        }
        Insert: {
          activated_snapshot_id?: string | null
          checksum?: string | null
          completed_at?: string | null
          correlation_id: string
          error?: string | null
          expected_record_count?: number | null
          id: string
          snapshot_id: string
          source: string
          staged_record_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          activated_snapshot_id?: string | null
          checksum?: string | null
          completed_at?: string | null
          correlation_id?: string
          error?: string | null
          expected_record_count?: number | null
          id?: string
          snapshot_id?: string
          source?: string
          staged_record_count?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_refresh_runs_activated_snapshot_fkey"
            columns: ["activated_snapshot_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_source_snapshots"
            referencedColumns: ["id", "source"]
          },
          {
            foreignKeyName: "exclusion_refresh_runs_snapshot_fkey"
            columns: ["snapshot_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_source_snapshots"
            referencedColumns: ["id", "source"]
          },
        ]
      }
      exclusion_screening_matches: {
        Row: {
          created_at: string
          employee_id: string
          exclusion_list_entry_id: string | null
          facility_id: string
          id: string
          match_score: number
          matched_name: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_notes: string | null
          source: string
          source_record_key: string | null
          status: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          exclusion_list_entry_id?: string | null
          facility_id: string
          id?: string
          match_score: number
          matched_name: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_notes?: string | null
          source: string
          source_record_key?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          exclusion_list_entry_id?: string | null
          facility_id?: string
          id?: string
          match_score?: number
          matched_name?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_notes?: string | null
          source?: string
          source_record_key?: string | null
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
      exclusion_source_snapshots: {
        Row: {
          activated_at: string | null
          checksum: string | null
          created_at: string
          id: string
          record_count: number | null
          refresh_run_id: string
          source: string
          status: string
          validated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          checksum?: string | null
          created_at?: string
          id: string
          record_count?: number | null
          refresh_run_id: string
          source: string
          status?: string
          validated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          checksum?: string | null
          created_at?: string
          id?: string
          record_count?: number | null
          refresh_run_id?: string
          source?: string
          status?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_source_snapshots_refresh_run_fkey"
            columns: ["refresh_run_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_refresh_runs"
            referencedColumns: ["id", "source"]
          },
        ]
      }
      exclusion_source_state: {
        Row: {
          active_snapshot_id: string | null
          last_attempt_at: string | null
          last_error: string | null
          last_run_id: string | null
          last_status: string
          last_success_at: string | null
          source: string
          stale_after: string
          updated_at: string
        }
        Insert: {
          active_snapshot_id?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_run_id?: string | null
          last_status?: string
          last_success_at?: string | null
          source: string
          stale_after?: string
          updated_at?: string
        }
        Update: {
          active_snapshot_id?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_run_id?: string | null
          last_status?: string
          last_success_at?: string | null
          source?: string
          stale_after?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_source_state_active_snapshot_fkey"
            columns: ["active_snapshot_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_source_snapshots"
            referencedColumns: ["id", "source"]
          },
          {
            foreignKeyName: "exclusion_source_state_last_run_fkey"
            columns: ["last_run_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_refresh_runs"
            referencedColumns: ["id", "source"]
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
          default_care_frequency: string | null
          default_care_responsible_party: string | null
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
          default_care_frequency?: string | null
          default_care_responsible_party?: string | null
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
          default_care_frequency?: string | null
          default_care_responsible_party?: string | null
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
      facility_units: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_units_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_definitions: {
        Row: {
          created_at: string
          default_value: Json
          description: string
          display_name: string
          feature_key: string
          is_active: boolean
          limit_unit: string | null
          schema_version: number
          updated_at: string
          value_type: string
        }
        Insert: {
          created_at?: string
          default_value: Json
          description?: string
          display_name: string
          feature_key: string
          is_active?: boolean
          limit_unit?: string | null
          schema_version?: number
          updated_at?: string
          value_type: string
        }
        Update: {
          created_at?: string
          default_value?: Json
          description?: string
          display_name?: string
          feature_key?: string
          is_active?: boolean
          limit_unit?: string | null
          schema_version?: number
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      feature_kill_switches: {
        Row: {
          activated_at: string
          activated_by: string | null
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          expires_at: string | null
          feature_key: string
          id: string
          is_disabled: boolean
          organization_id: string | null
          reason: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          activated_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          expires_at?: string | null
          feature_key: string
          id?: string
          is_disabled?: boolean
          organization_id?: string | null
          reason: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          activated_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          expires_at?: string | null
          feature_key?: string
          id?: string
          is_disabled?: boolean
          organization_id?: string | null
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_kill_switches_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_kill_switches_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_kill_switches_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_definitions"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "feature_kill_switches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governed_content_assets: {
        Row: {
          asset_type: string
          created_at: string
          current_published_revision_id: string | null
          id: string
          organization_id: string | null
          owner_profile_id: string | null
          platform_owned: boolean
          source_id: string
          status: string
          template_asset_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          current_published_revision_id?: string | null
          id?: string
          organization_id?: string | null
          owner_profile_id?: string | null
          platform_owned?: boolean
          source_id: string
          status?: string
          template_asset_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          current_published_revision_id?: string | null
          id?: string
          organization_id?: string | null
          owner_profile_id?: string | null
          platform_owned?: boolean
          source_id?: string
          status?: string
          template_asset_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governed_content_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_assets_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_assets_template_asset_id_fkey"
            columns: ["template_asset_id"]
            isOneToOne: false
            referencedRelation: "governed_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_current_revision_fk"
            columns: ["current_published_revision_id"]
            isOneToOne: false
            referencedRelation: "governed_content_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      governed_content_publication_events: {
        Row: {
          actor_profile_id: string | null
          asset_id: string
          event_type: string
          evidence: Json
          id: string
          occurred_at: string
          organization_id: string | null
          reason: string
          revision_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          asset_id: string
          event_type: string
          evidence?: Json
          id?: string
          occurred_at?: string
          organization_id?: string | null
          reason: string
          revision_id: string
        }
        Update: {
          actor_profile_id?: string | null
          asset_id?: string
          event_type?: string
          evidence?: Json
          id?: string
          occurred_at?: string
          organization_id?: string | null
          reason?: string
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governed_content_publication_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_publication_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "governed_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_publication_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_publication_events_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "governed_content_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      governed_content_review_comments: {
        Row: {
          author_profile_id: string
          body: string
          created_at: string
          id: string
          organization_id: string | null
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          revision_id: string
          section_path: string | null
        }
        Insert: {
          author_profile_id: string
          body: string
          created_at?: string
          id?: string
          organization_id?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          revision_id: string
          section_path?: string | null
        }
        Update: {
          author_profile_id?: string
          body?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          revision_id?: string
          section_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governed_content_review_comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_review_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_review_comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_review_comments_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "governed_content_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      governed_content_revisions: {
        Row: {
          asset_id: string
          authored_by: string
          change_summary: string
          created_at: string
          id: string
          material_change: boolean
          material_change_action: string
          organization_id: string | null
          published_at: string | null
          published_by: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision_number: number
          snapshot: Json
          snapshot_sha256: string
          source_version_id: string | null
          state: string
          submitted_at: string | null
          supersedes_revision_id: string | null
          validation_results: Json
        }
        Insert: {
          asset_id: string
          authored_by: string
          change_summary: string
          created_at?: string
          id?: string
          material_change?: boolean
          material_change_action?: string
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision_number: number
          snapshot: Json
          snapshot_sha256: string
          source_version_id?: string | null
          state?: string
          submitted_at?: string | null
          supersedes_revision_id?: string | null
          validation_results?: Json
        }
        Update: {
          asset_id?: string
          authored_by?: string
          change_summary?: string
          created_at?: string
          id?: string
          material_change?: boolean
          material_change_action?: string
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision_number?: number
          snapshot?: Json
          snapshot_sha256?: string
          source_version_id?: string | null
          state?: string
          submitted_at?: string | null
          supersedes_revision_id?: string | null
          validation_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "governed_content_revisions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "governed_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_revisions_authored_by_fkey"
            columns: ["authored_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_revisions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_revisions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_content_revisions_supersedes_revision_id_fkey"
            columns: ["supersedes_revision_id"]
            isOneToOne: false
            referencedRelation: "governed_content_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          article_type: string
          category: string
          content: Json
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          article_type: string
          category: string
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          article_type?: string
          category?: string
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_metric_snapshots: {
        Row: {
          created_at: string
          dimension_version: Json
          facility_id: string | null
          id: string
          metric_domain: string
          metrics: Json
          metrics_sha256: string
          organization_id: string
          period_end: string
          period_start: string
          source_snapshot_id: string | null
        }
        Insert: {
          created_at?: string
          dimension_version: Json
          facility_id?: string | null
          id?: string
          metric_domain: string
          metrics: Json
          metrics_sha256: string
          organization_id: string
          period_end: string
          period_start: string
          source_snapshot_id?: string | null
        }
        Update: {
          created_at?: string
          dimension_version?: Json
          facility_id?: string | null
          id?: string
          metric_domain?: string
          metrics?: Json
          metrics_sha256?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          source_snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_metric_snapshots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_metric_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_metric_snapshots_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      hris_identity_links: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          external_employment_id: string
          external_person_id: string
          id: string
          organization_id: string
          person_id: string
          source_checksum_sha256: string | null
          source_system_id: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          external_employment_id: string
          external_person_id: string
          id?: string
          organization_id: string
          person_id: string
          source_checksum_sha256?: string | null
          source_system_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          external_employment_id?: string
          external_person_id?: string
          id?: string
          organization_id?: string
          person_id?: string
          source_checksum_sha256?: string | null
          source_system_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hris_identity_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_identity_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_identity_links_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "workforce_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_identity_links_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "hris_source_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      hris_import_exceptions: {
        Row: {
          created_at: string
          details: Json
          exception_code: string
          id: string
          import_row_id: string | null
          import_run_id: string
          organization_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          exception_code: string
          id?: string
          import_row_id?: string | null
          import_run_id: string
          organization_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          exception_code?: string
          id?: string
          import_row_id?: string | null
          import_run_id?: string
          organization_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hris_import_exceptions_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "hris_import_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_exceptions_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "hris_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hris_import_rows: {
        Row: {
          applied_at: string | null
          applied_employee_id: string | null
          applied_lifecycle_event_id: string | null
          apply_status: string
          candidate_employee_ids: string[]
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_employee_id: string | null
          decision_reason: string | null
          error_codes: string[]
          error_detail: string | null
          external_employment_id: string | null
          external_person_id: string | null
          id: string
          import_run_id: string
          match_status: string
          merge_decision: string | null
          normalized_payload: Json
          organization_id: string
          row_number: number
          source_payload_sha256: string
          source_system_id: string
          updated_at: string
          validation_status: string
        }
        Insert: {
          applied_at?: string | null
          applied_employee_id?: string | null
          applied_lifecycle_event_id?: string | null
          apply_status?: string
          candidate_employee_ids?: string[]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_employee_id?: string | null
          decision_reason?: string | null
          error_codes?: string[]
          error_detail?: string | null
          external_employment_id?: string | null
          external_person_id?: string | null
          id?: string
          import_run_id: string
          match_status?: string
          merge_decision?: string | null
          normalized_payload: Json
          organization_id: string
          row_number: number
          source_payload_sha256: string
          source_system_id: string
          updated_at?: string
          validation_status?: string
        }
        Update: {
          applied_at?: string | null
          applied_employee_id?: string | null
          applied_lifecycle_event_id?: string | null
          apply_status?: string
          candidate_employee_ids?: string[]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_employee_id?: string | null
          decision_reason?: string | null
          error_codes?: string[]
          error_detail?: string | null
          external_employment_id?: string | null
          external_person_id?: string | null
          id?: string
          import_run_id?: string
          match_status?: string
          merge_decision?: string | null
          normalized_payload?: Json
          organization_id?: string
          row_number?: number
          source_payload_sha256?: string
          source_system_id?: string
          updated_at?: string
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hris_import_rows_applied_employee_id_fkey"
            columns: ["applied_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_applied_lifecycle_event_id_fkey"
            columns: ["applied_lifecycle_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_decided_employee_id_fkey"
            columns: ["decided_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "hris_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_rows_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "hris_source_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      hris_import_runs: {
        Row: {
          applied_count: number
          completed_at: string | null
          correlation_id: string
          created_at: string
          id: string
          import_mode: string
          mapping_version: number
          organization_id: string
          reconciliation: Json
          rejected_count: number
          request_id: string
          resume_after_row: number
          review_count: number
          source_checksum_sha256: string | null
          source_count: number | null
          source_cursor: string | null
          source_system_id: string
          staged_count: number
          started_by: string | null
          status: string
          updated_at: string
          validated_at: string | null
        }
        Insert: {
          applied_count?: number
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          import_mode: string
          mapping_version: number
          organization_id: string
          reconciliation?: Json
          rejected_count?: number
          request_id: string
          resume_after_row?: number
          review_count?: number
          source_checksum_sha256?: string | null
          source_count?: number | null
          source_cursor?: string | null
          source_system_id: string
          staged_count?: number
          started_by?: string | null
          status?: string
          updated_at?: string
          validated_at?: string | null
        }
        Update: {
          applied_count?: number
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          import_mode?: string
          mapping_version?: number
          organization_id?: string
          reconciliation?: Json
          rejected_count?: number
          request_id?: string
          resume_after_row?: number
          review_count?: number
          source_checksum_sha256?: string | null
          source_count?: number | null
          source_cursor?: string | null
          source_system_id?: string
          staged_count?: number
          started_by?: string | null
          status?: string
          updated_at?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hris_import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_runs_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "hris_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_import_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hris_source_systems: {
        Row: {
          adapter_config: Json
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          import_mode: string
          last_cursor: string | null
          last_reconciled_at: string | null
          mapping_config: Json
          mapping_version: number
          organization_id: string
          provider_type: string
          schedule_cron: string | null
          source_key: string
          status: string
          updated_at: string
        }
        Insert: {
          adapter_config?: Json
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          import_mode?: string
          last_cursor?: string | null
          last_reconciled_at?: string | null
          mapping_config?: Json
          mapping_version?: number
          organization_id: string
          provider_type: string
          schedule_cron?: string | null
          source_key: string
          status?: string
          updated_at?: string
        }
        Update: {
          adapter_config?: Json
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          import_mode?: string
          last_cursor?: string | null
          last_reconciled_at?: string | null
          mapping_config?: Json
          mapping_version?: number
          organization_id?: string
          provider_type?: string
          schedule_cron?: string | null
          source_key?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hris_source_systems_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hris_source_systems_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_break_glass_events: {
        Row: {
          approved_by: string
          created_at: string
          evidence_checksum_sha256: string
          expires_at: string
          granted_at: string
          id: string
          organization_id: string | null
          reason: string
          requested_by: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          target_profile_id: string
          ticket_reference: string
        }
        Insert: {
          approved_by: string
          created_at?: string
          evidence_checksum_sha256: string
          expires_at: string
          granted_at?: string
          id?: string
          organization_id?: string | null
          reason: string
          requested_by: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_profile_id: string
          ticket_reference: string
        }
        Update: {
          approved_by?: string
          created_at?: string
          evidence_checksum_sha256?: string
          expires_at?: string
          granted_at?: string
          id?: string
          organization_id?: string | null
          reason?: string
          requested_by?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_profile_id?: string
          ticket_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_break_glass_events_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_break_glass_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_break_glass_events_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_break_glass_events_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_break_glass_events_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_security_policies: {
        Row: {
          created_at: string
          max_privileged_session_minutes: number
          organization_id: string
          privileged_roles: string[]
          require_aal2: boolean
          sensitive_operations: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          max_privileged_session_minutes?: number
          organization_id: string
          privileged_roles?: string[]
          require_aal2?: boolean
          sensitive_operations?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          max_privileged_session_minutes?: number
          organization_id?: string
          privileged_roles?: string[]
          require_aal2?: boolean
          sensitive_operations?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_security_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_security_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_session_revocations: {
        Row: {
          evidence_checksum_sha256: string
          external_request_id: string | null
          id: string
          organization_id: string | null
          profile_deactivated: boolean
          profile_id: string
          reason: string
          requested_by: string | null
          revoked_at: string
          revoked_session_count: number
          revoked_session_ids: Json
          source: string
        }
        Insert: {
          evidence_checksum_sha256: string
          external_request_id?: string | null
          id?: string
          organization_id?: string | null
          profile_deactivated: boolean
          profile_id: string
          reason: string
          requested_by?: string | null
          revoked_at?: string
          revoked_session_count: number
          revoked_session_ids?: Json
          source: string
        }
        Update: {
          evidence_checksum_sha256?: string
          external_request_id?: string | null
          id?: string
          organization_id?: string | null
          profile_deactivated?: boolean
          profile_id?: string
          reason?: string
          requested_by?: string | null
          revoked_at?: string
          revoked_session_count?: number
          revoked_session_ids?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_session_revocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_session_revocations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_session_revocations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_subject_links: {
        Row: {
          identity_id: string
          last_authenticated_at: string | null
          link_method: string
          linked_at: string
          linked_by: string | null
          organization_id: string
          profile_id: string
          provider_subject: string
          sso_connection_id: string
          unlink_reason: string | null
          unlinked_at: string | null
        }
        Insert: {
          identity_id?: string
          last_authenticated_at?: string | null
          link_method: string
          linked_at?: string
          linked_by?: string | null
          organization_id: string
          profile_id: string
          provider_subject: string
          sso_connection_id: string
          unlink_reason?: string | null
          unlinked_at?: string | null
        }
        Update: {
          identity_id?: string
          last_authenticated_at?: string | null
          link_method?: string
          linked_at?: string
          linked_by?: string | null
          organization_id?: string
          profile_id?: string
          provider_subject?: string
          sso_connection_id?: string
          unlink_reason?: string | null
          unlinked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_subject_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_subject_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_subject_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_subject_links_sso_connection_id_fkey"
            columns: ["sso_connection_id"]
            isOneToOne: false
            referencedRelation: "organization_sso_connections"
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
      integration_api_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          rate_limit_per_minute: number
          replaced_by_id: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          rotated_from_id: string | null
          scopes: string[]
          status: string
          updated_at: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          rate_limit_per_minute?: number
          replaced_by_id?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          rotated_from_id?: string | null
          scopes: string[]
          status?: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          rate_limit_per_minute?: number
          replaced_by_id?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          rotated_from_id?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "integration_api_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_api_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_api_credentials_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "integration_api_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_api_credentials_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_api_credentials_rotated_from_id_fkey"
            columns: ["rotated_from_id"]
            isOneToOne: false
            referencedRelation: "integration_api_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_api_scope_definitions: {
        Row: {
          created_at: string
          description: string
          is_active: boolean
          risk_level: string
          scope_key: string
        }
        Insert: {
          created_at?: string
          description: string
          is_active?: boolean
          risk_level: string
          scope_key: string
        }
        Update: {
          created_at?: string
          description?: string
          is_active?: boolean
          risk_level?: string
          scope_key?: string
        }
        Relationships: []
      }
      integration_schema_definitions: {
        Row: {
          created_at: string
          deprecated_at: string | null
          id: string
          json_schema: Json
          lifecycle_status: string
          replacement_schema_name: string | null
          schema_kind: string
          schema_name: string
          schema_version: string
          sunset_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deprecated_at?: string | null
          id?: string
          json_schema?: Json
          lifecycle_status?: string
          replacement_schema_name?: string | null
          schema_kind: string
          schema_name: string
          schema_version: string
          sunset_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deprecated_at?: string | null
          id?: string
          json_schema?: Json
          lifecycle_status?: string
          replacement_schema_name?: string | null
          schema_kind?: string
          schema_name?: string
          schema_version?: string
          sunset_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integration_webhook_deliveries: {
        Row: {
          attempt_count: number
          available_at: string
          correlation_id: string
          created_at: string
          dead_lettered_at: string | null
          delivered_at: string | null
          endpoint_id: string
          event_id: string
          event_schema_version: string
          event_sequence: number
          event_type: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          last_http_status: number | null
          locked_at: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          payload_sha256: string
          replay_count: number
          replay_of_delivery_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          correlation_id: string
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          endpoint_id: string
          event_id: string
          event_schema_version: string
          event_sequence: number
          event_type: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_http_status?: number | null
          locked_at?: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          payload_sha256: string
          replay_count?: number
          replay_of_delivery_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          correlation_id?: string
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          endpoint_id?: string
          event_id?: string
          event_schema_version?: string
          event_sequence?: number
          event_type?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_http_status?: number | null
          locked_at?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          payload_sha256?: string
          replay_count?: number
          replay_of_delivery_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_deliveries_endpoint_id_organization_id_fkey"
            columns: ["endpoint_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "integration_webhook_endpoints"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "integration_webhook_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_deliveries_replay_of_delivery_id_fkey"
            columns: ["replay_of_delivery_id"]
            isOneToOne: false
            referencedRelation: "integration_webhook_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhook_delivery_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          delivery_id: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          organization_id: string
          outcome: string
          request_signature_version: number
          request_timestamp: number
          response_http_status: number | null
          response_sha256: string | null
        }
        Insert: {
          attempt_number: number
          created_at?: string
          delivery_id: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          outcome: string
          request_signature_version: number
          request_timestamp: number
          response_http_status?: number | null
          response_sha256?: string | null
        }
        Update: {
          attempt_number?: number
          created_at?: string
          delivery_id?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          outcome?: string
          request_signature_version?: number
          request_timestamp?: number
          response_http_status?: number | null
          response_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_delivery_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "integration_webhook_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_delivery_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhook_endpoints: {
        Row: {
          consecutive_failures: number
          created_at: string
          created_by: string | null
          description: string
          destination_url: string
          disable_reason: string | null
          disabled_at: string | null
          disabled_by: string | null
          id: string
          last_failure_at: string | null
          last_success_at: string | null
          max_attempts: number
          name: string
          organization_id: string
          secret_version: number
          status: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          description?: string
          destination_url: string
          disable_reason?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          max_attempts?: number
          name: string
          organization_id: string
          secret_version?: number
          status?: string
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          description?: string
          destination_url?: string
          disable_reason?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          max_attempts?: number
          name?: string
          organization_id?: string
          secret_version?: number
          status?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_endpoints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_endpoints_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_endpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhook_subscriptions: {
        Row: {
          created_at: string
          created_by: string | null
          endpoint_id: string
          event_schema_version: string
          event_type: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          endpoint_id: string
          event_schema_version?: string
          event_type: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          endpoint_id?: string
          event_schema_version?: string
          event_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_subscripti_endpoint_id_organization_id_fkey"
            columns: ["endpoint_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "integration_webhook_endpoints"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "integration_webhook_subscriptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_webhook_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_packages: {
        Row: {
          capabilities: string[]
          compressed_bytes: number
          connectivity_mode: string
          content_sha256: string
          course_version_id: string
          created_at: string
          created_by: string | null
          entry_point: string | null
          expanded_bytes: number | null
          id: string
          immutable_at: string | null
          manifest: Json
          organization_id: string | null
          scanner_name: string | null
          scanner_version: string | null
          standard_type: string
          storage_bucket: string
          storage_path: string
          validated_at: string | null
          validation_results: Json
          validation_status: string
        }
        Insert: {
          capabilities?: string[]
          compressed_bytes: number
          connectivity_mode?: string
          content_sha256: string
          course_version_id: string
          created_at?: string
          created_by?: string | null
          entry_point?: string | null
          expanded_bytes?: number | null
          id?: string
          immutable_at?: string | null
          manifest?: Json
          organization_id?: string | null
          scanner_name?: string | null
          scanner_version?: string | null
          standard_type: string
          storage_bucket?: string
          storage_path: string
          validated_at?: string | null
          validation_results?: Json
          validation_status?: string
        }
        Update: {
          capabilities?: string[]
          compressed_bytes?: number
          connectivity_mode?: string
          content_sha256?: string
          course_version_id?: string
          created_at?: string
          created_by?: string | null
          entry_point?: string | null
          expanded_bytes?: number | null
          id?: string
          immutable_at?: string | null
          manifest?: Json
          organization_id?: string | null
          scanner_name?: string | null
          scanner_version?: string | null
          standard_type?: string
          storage_bucket?: string
          storage_path?: string
          validated_at?: string | null
          validation_results?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_packages_course_version_id_fkey"
            columns: ["course_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_path_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          current_state: Json
          due_at: string | null
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          path_version_id: string
          state: string
          state_version: number
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          current_state?: Json
          due_at?: string | null
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          path_version_id: string
          state?: string
          state_version?: number
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          current_state?: Json
          due_at?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          path_version_id?: string
          state?: string
          state_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "learning_path_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_assignments_path_version_id_fkey"
            columns: ["path_version_id"]
            isOneToOne: false
            referencedRelation: "learning_path_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_path_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_path_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "learning_path_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_path_transition_events: {
        Row: {
          explanation: string
          id: string
          occurred_at: string
          organization_id: string
          path_assignment_id: string
          prior_state: string | null
          reason_code: string
          resulting_state: string
          source_outcome: Json
          state_version: number
          step_key: string
        }
        Insert: {
          explanation: string
          id?: string
          occurred_at?: string
          organization_id: string
          path_assignment_id: string
          prior_state?: string | null
          reason_code: string
          resulting_state: string
          source_outcome?: Json
          state_version: number
          step_key: string
        }
        Update: {
          explanation?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          path_assignment_id?: string
          prior_state?: string | null
          reason_code?: string
          resulting_state?: string
          source_outcome?: Json
          state_version?: number
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_path_transition_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_transition_events_path_assignment_id_fkey"
            columns: ["path_assignment_id"]
            isOneToOne: false
            referencedRelation: "learning_path_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_path_versions: {
        Row: {
          created_at: string
          definition: Json
          definition_sha256: string
          id: string
          organization_id: string
          path_definition_id: string
          published_at: string | null
          published_by: string | null
          state: string
          version_number: number
        }
        Insert: {
          created_at?: string
          definition: Json
          definition_sha256: string
          id?: string
          organization_id: string
          path_definition_id: string
          published_at?: string | null
          published_by?: string | null
          state?: string
          version_number: number
        }
        Update: {
          created_at?: string
          definition?: Json
          definition_sha256?: string
          id?: string
          organization_id?: string
          path_definition_id?: string
          published_at?: string | null
          published_by?: string | null
          state?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "learning_path_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_versions_path_definition_id_fkey"
            columns: ["path_definition_id"]
            isOneToOne: false
            referencedRelation: "learning_path_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_path_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_runtime_commits: {
        Row: {
          committed_at: string
          completion_status: string | null
          id: string
          idempotency_key: string
          organization_id: string
          progress_measure: number | null
          raw_state: Json
          runtime_session_id: string
          score_max: number | null
          score_min: number | null
          score_raw: number | null
          sequence_number: number
          session_time_seconds: number | null
          state_sha256: string
          success_status: string | null
          suspend_data: string | null
        }
        Insert: {
          committed_at?: string
          completion_status?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          progress_measure?: number | null
          raw_state?: Json
          runtime_session_id: string
          score_max?: number | null
          score_min?: number | null
          score_raw?: number | null
          sequence_number: number
          session_time_seconds?: number | null
          state_sha256: string
          success_status?: string | null
          suspend_data?: string | null
        }
        Update: {
          committed_at?: string
          completion_status?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          progress_measure?: number | null
          raw_state?: Json
          runtime_session_id?: string
          score_max?: number | null
          score_min?: number | null
          score_raw?: number | null
          sequence_number?: number
          session_time_seconds?: number | null
          state_sha256?: string
          success_status?: string | null
          suspend_data?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_runtime_commits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_runtime_commits_runtime_session_id_fkey"
            columns: ["runtime_session_id"]
            isOneToOne: false
            referencedRelation: "learning_runtime_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_runtime_sessions: {
        Row: {
          assignment_id: string
          employee_id: string
          expires_at: string
          id: string
          last_commit_at: string | null
          launch_nonce_sha256: string
          launched_at: string
          organization_id: string
          package_id: string
          registration_key: string
          runtime_standard: string
          state: string
        }
        Insert: {
          assignment_id: string
          employee_id: string
          expires_at: string
          id?: string
          last_commit_at?: string | null
          launch_nonce_sha256: string
          launched_at?: string
          organization_id: string
          package_id: string
          registration_key: string
          runtime_standard: string
          state?: string
        }
        Update: {
          assignment_id?: string
          employee_id?: string
          expires_at?: string
          id?: string
          last_commit_at?: string | null
          launch_nonce_sha256?: string
          launched_at?: string
          organization_id?: string
          package_id?: string
          registration_key?: string
          runtime_standard?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_runtime_sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_runtime_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_runtime_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_runtime_sessions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "learning_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      lti_launch_receipts: {
        Row: {
          assignment_id: string | null
          deployment_id: string
          employee_id: string
          id: string
          launched_at: string
          message_type: string
          nonce_sha256: string
          organization_id: string
          registration_id: string
          state_sha256: string
          target_link_uri: string
        }
        Insert: {
          assignment_id?: string | null
          deployment_id: string
          employee_id: string
          id?: string
          launched_at?: string
          message_type: string
          nonce_sha256: string
          organization_id: string
          registration_id: string
          state_sha256: string
          target_link_uri: string
        }
        Update: {
          assignment_id?: string | null
          deployment_id?: string
          employee_id?: string
          id?: string
          launched_at?: string
          message_type?: string
          nonce_sha256?: string
          organization_id?: string
          registration_id?: string
          state_sha256?: string
          target_link_uri?: string
        }
        Relationships: [
          {
            foreignKeyName: "lti_launch_receipts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lti_launch_receipts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lti_launch_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lti_launch_receipts_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "lti_tool_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      lti_tool_registrations: {
        Row: {
          allowed_roles: string[]
          authorization_endpoint: string
          client_id: string
          created_at: string
          created_by: string | null
          deployment_ids: string[]
          id: string
          issuer: string
          jwks_uri: string
          organization_id: string
          status: string
        }
        Insert: {
          allowed_roles?: string[]
          authorization_endpoint: string
          client_id: string
          created_at?: string
          created_by?: string | null
          deployment_ids?: string[]
          id?: string
          issuer: string
          jwks_uri: string
          organization_id: string
          status?: string
        }
        Update: {
          allowed_roles?: string[]
          authorization_endpoint?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          deployment_ids?: string[]
          id?: string
          issuer?: string
          jwks_uri?: string
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lti_tool_registrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lti_tool_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      move_in_guest_access_events: {
        Row: {
          event_type: string
          facility_id: string
          guest_grant_id: string
          id: string
          ip_hash: string | null
          occurred_at: string
          organization_id: string
          task_id: string | null
          user_agent_hash: string | null
          workspace_id: string
        }
        Insert: {
          event_type: string
          facility_id: string
          guest_grant_id: string
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          organization_id: string
          task_id?: string | null
          user_agent_hash?: string | null
          workspace_id: string
        }
        Update: {
          event_type?: string
          facility_id?: string
          guest_grant_id?: string
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          organization_id?: string
          task_id?: string | null
          user_agent_hash?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "move_in_guest_access_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_access_events_guest_grant_id_fkey"
            columns: ["guest_grant_id"]
            isOneToOne: false
            referencedRelation: "move_in_guest_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_access_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_access_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "move_in_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_access_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "move_in_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      move_in_guest_grants: {
        Row: {
          accepted_at: string | null
          allowed_task_ids: string[]
          created_at: string
          created_by: string | null
          expires_at: string
          facility_id: string
          guest_label: string
          id: string
          organization_id: string
          resident_id: string
          revoked_at: string | null
          terms_version: string
          token_sha256: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          allowed_task_ids?: string[]
          created_at?: string
          created_by?: string | null
          expires_at: string
          facility_id: string
          guest_label: string
          id?: string
          organization_id: string
          resident_id: string
          revoked_at?: string | null
          terms_version: string
          token_sha256: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          allowed_task_ids?: string[]
          created_at?: string
          created_by?: string | null
          expires_at?: string
          facility_id?: string
          guest_label?: string
          id?: string
          organization_id?: string
          resident_id?: string
          revoked_at?: string | null
          terms_version?: string
          token_sha256?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "move_in_guest_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_grants_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_grants_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_guest_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "move_in_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      move_in_tasks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          depends_on_task_keys: string[]
          document_id: string | null
          due_at: string | null
          exception_reason: string | null
          facility_id: string
          id: string
          organization_id: string
          owner_profile_id: string | null
          requires_approval: boolean
          requires_document: boolean
          requires_signature: boolean
          signature_evidence: Json | null
          state: string
          task_key: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          depends_on_task_keys?: string[]
          document_id?: string | null
          due_at?: string | null
          exception_reason?: string | null
          facility_id: string
          id?: string
          organization_id: string
          owner_profile_id?: string | null
          requires_approval?: boolean
          requires_document?: boolean
          requires_signature?: boolean
          signature_evidence?: Json | null
          state?: string
          task_key: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          depends_on_task_keys?: string[]
          document_id?: string | null
          due_at?: string | null
          exception_reason?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          owner_profile_id?: string | null
          requires_approval?: boolean
          requires_document?: boolean
          requires_signature?: boolean
          signature_evidence?: Json | null
          state?: string
          task_key?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "move_in_tasks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_tasks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "resident_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_tasks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_tasks_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "move_in_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      move_in_templates: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          is_active: boolean
          name: string
          organization_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "move_in_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      move_in_workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string
          id: string
          organization_id: string
          readiness_snapshot: Json
          resident_id: string
          state: string
          target_move_in_date: string
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id: string
          id?: string
          organization_id: string
          readiness_snapshot?: Json
          resident_id: string
          state?: string
          target_move_in_date: string
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          readiness_snapshot?: Json
          resident_id?: string
          state?: string
          target_move_in_date?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "move_in_workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_workspaces_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_workspaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_workspaces_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_in_workspaces_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "move_in_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_channel_policies: {
        Row: {
          created_at: string
          fallback_delay_minutes: number
          fallback_enabled: boolean
          max_fallback_depth: number
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          fallback_delay_minutes?: number
          fallback_enabled?: boolean
          max_fallback_depth?: number
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          fallback_delay_minutes?: number
          fallback_enabled?: boolean
          max_fallback_depth?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_channel_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_channel_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_consent_events: {
        Row: {
          action: string
          attempt_id: string | null
          channel: string
          id: string
          occurred_at: string
          organization_id: string | null
          profile_id: string | null
          provider: string
          provider_event_id: string
          received_at: string
          recipient_fingerprint: string
          source: string
        }
        Insert: {
          action: string
          attempt_id?: string | null
          channel: string
          id?: string
          occurred_at: string
          organization_id?: string | null
          profile_id?: string | null
          provider: string
          provider_event_id: string
          received_at?: string
          recipient_fingerprint: string
          source: string
        }
        Update: {
          action?: string
          attempt_id?: string | null
          channel?: string
          id?: string
          occurred_at?: string
          organization_id?: string | null
          profile_id?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          recipient_fingerprint?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_consent_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "notification_delivery_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_consent_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_consent_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          accepted_at: string | null
          attempt_count: number
          channel: string
          created_at: string
          delivered_at: string | null
          delivery_type: string
          error_code: string | null
          error_message: string | null
          escalation_reason: string | null
          fallback_group_id: string
          fallback_sequence: number
          final_outcome: string | null
          finalized_at: string | null
          id: string
          last_provider_status: string | null
          next_attempt_at: string
          notification_id: string | null
          organization_id: string
          parent_delivery_id: string | null
          profile_id: string
          provider: string | null
          provider_message_id: string | null
          quiet_hours_deferred_count: number
          recipient: string
          sent_at: string | null
          skip_reason: string | null
          status: string
          template_version_id: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempt_count?: number
          channel: string
          created_at?: string
          delivered_at?: string | null
          delivery_type?: string
          error_code?: string | null
          error_message?: string | null
          escalation_reason?: string | null
          fallback_group_id?: string
          fallback_sequence?: number
          final_outcome?: string | null
          finalized_at?: string | null
          id?: string
          last_provider_status?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          organization_id: string
          parent_delivery_id?: string | null
          profile_id: string
          provider?: string | null
          provider_message_id?: string | null
          quiet_hours_deferred_count?: number
          recipient: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          template_version_id?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempt_count?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          delivery_type?: string
          error_code?: string | null
          error_message?: string | null
          escalation_reason?: string | null
          fallback_group_id?: string
          fallback_sequence?: number
          final_outcome?: string | null
          finalized_at?: string | null
          id?: string
          last_provider_status?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          organization_id?: string
          parent_delivery_id?: string | null
          profile_id?: string
          provider?: string | null
          provider_message_id?: string | null
          quiet_hours_deferred_count?: number
          recipient?: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          template_version_id?: string | null
          updated_at?: string
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
            foreignKeyName: "notification_deliveries_parent_delivery_id_fkey"
            columns: ["parent_delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_attempts: {
        Row: {
          accepted_at: string | null
          attempt_number: number
          callback_token: string
          content_sha256: string | null
          delivery_id: string
          error_code: string | null
          error_detail: string | null
          estimated_cost_micros: number
          finalized_at: string | null
          id: string
          organization_id: string
          profile_id: string
          provider: string
          provider_message_id: string | null
          provider_status: string | null
          response_status: number | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempt_number: number
          callback_token?: string
          content_sha256?: string | null
          delivery_id: string
          error_code?: string | null
          error_detail?: string | null
          estimated_cost_micros?: number
          finalized_at?: string | null
          id?: string
          organization_id: string
          profile_id: string
          provider: string
          provider_message_id?: string | null
          provider_status?: string | null
          response_status?: number | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempt_number?: number
          callback_token?: string
          content_sha256?: string | null
          delivery_id?: string
          error_code?: string | null
          error_detail?: string | null
          estimated_cost_micros?: number
          finalized_at?: string | null
          id?: string
          organization_id?: string
          profile_id?: string
          provider?: string
          provider_message_id?: string | null
          provider_status?: string | null
          response_status?: number | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_attempts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_provider_events: {
        Row: {
          attempt_id: string
          delivery_id: string
          error_code: string | null
          error_detail: string | null
          event_type: string
          id: string
          occurred_at: string
          organization_id: string
          outcome: string | null
          provider: string
          provider_event_id: string
          provider_message_id: string | null
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          attempt_id: string
          delivery_id: string
          error_code?: string | null
          error_detail?: string | null
          event_type: string
          id?: string
          occurred_at: string
          organization_id: string
          outcome?: string | null
          provider: string
          provider_event_id: string
          provider_message_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Update: {
          attempt_id?: string
          delivery_id?: string
          error_code?: string | null
          error_detail?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          outcome?: string | null
          provider?: string
          provider_event_id?: string
          provider_message_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_provider_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "notification_delivery_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_provider_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_provider_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_spend_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          budget_micros: number
          created_at: string
          estimated_spend_micros: number
          id: string
          organization_id: string
          period_start: string
          status: string
          threshold_percent: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          budget_micros: number
          created_at?: string
          estimated_spend_micros: number
          id?: string
          organization_id: string
          period_start: string
          status?: string
          threshold_percent: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          budget_micros?: number
          created_at?: string
          estimated_spend_micros?: number
          id?: string
          organization_id?: string
          period_start?: string
          status?: string
          threshold_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_spend_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_spend_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_spend_policies: {
        Row: {
          created_at: string
          currency: string
          email_estimate_micros: number
          monthly_budget_micros: number | null
          organization_id: string
          sms_estimate_micros: number
          updated_at: string
          updated_by: string | null
          warning_percent: number
        }
        Insert: {
          created_at?: string
          currency?: string
          email_estimate_micros?: number
          monthly_budget_micros?: number | null
          organization_id: string
          sms_estimate_micros?: number
          updated_at?: string
          updated_by?: string | null
          warning_percent?: number
        }
        Update: {
          created_at?: string
          currency?: string
          email_estimate_micros?: number
          monthly_budget_micros?: number | null
          organization_id?: string
          sms_estimate_micros?: number
          updated_at?: string
          updated_by?: string | null
          warning_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_spend_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_spend_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          allowed_variables: string[]
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string | null
          status: string
          subject_template: string
          supersedes_id: string | null
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          allowed_variables?: string[]
          body_template: string
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          status?: string
          subject_template: string
          supersedes_id?: string | null
          template_key: string
          updated_at?: string
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          allowed_variables?: string[]
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          status?: string
          subject_template?: string
          supersedes_id?: string | null
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
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
      offline_content_manifests: {
        Row: {
          allowlisted_assets: Json
          content_sha256: string
          course_version_id: string
          created_at: string
          device_id: string
          encrypted_content_key: string
          expires_at: string
          id: string
          manifest_version: number
          organization_id: string
          profile_id: string
          withdrawn_at: string | null
        }
        Insert: {
          allowlisted_assets: Json
          content_sha256: string
          course_version_id: string
          created_at?: string
          device_id: string
          encrypted_content_key: string
          expires_at: string
          id?: string
          manifest_version: number
          organization_id: string
          profile_id: string
          withdrawn_at?: string | null
        }
        Update: {
          allowlisted_assets?: Json
          content_sha256?: string
          course_version_id?: string
          created_at?: string
          device_id?: string
          encrypted_content_key?: string
          expires_at?: string
          id?: string
          manifest_version?: number
          organization_id?: string
          profile_id?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_content_manifests_course_version_id_fkey"
            columns: ["course_version_id"]
            isOneToOne: false
            referencedRelation: "course_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_content_manifests_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "offline_device_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_content_manifests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_content_manifests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_device_registrations: {
        Row: {
          created_at: string
          device_fingerprint_sha256: string
          device_public_key: string
          id: string
          last_sync_at: string | null
          organization_id: string
          profile_id: string
          revoked_at: string | null
          role_at_registration: string
          status: string
          wipe_required_at: string | null
        }
        Insert: {
          created_at?: string
          device_fingerprint_sha256: string
          device_public_key: string
          id?: string
          last_sync_at?: string | null
          organization_id: string
          profile_id: string
          revoked_at?: string | null
          role_at_registration: string
          status?: string
          wipe_required_at?: string | null
        }
        Update: {
          created_at?: string
          device_fingerprint_sha256?: string
          device_public_key?: string
          id?: string
          last_sync_at?: string | null
          organization_id?: string
          profile_id?: string
          revoked_at?: string | null
          role_at_registration?: string
          status?: string
          wipe_required_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_device_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_device_registrations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_receipts: {
        Row: {
          action_type: string
          assignment_id: string
          client_base_version: number
          client_occurred_at: string
          client_sequence: number
          conflict_detail: Json
          device_id: string
          id: string
          idempotency_key: string
          organization_id: string
          outcome: string
          payload: Json
          payload_sha256: string
          processed_at: string
          profile_id: string
          server_version: number | null
        }
        Insert: {
          action_type: string
          assignment_id: string
          client_base_version: number
          client_occurred_at: string
          client_sequence: number
          conflict_detail?: Json
          device_id: string
          id?: string
          idempotency_key: string
          organization_id: string
          outcome: string
          payload: Json
          payload_sha256: string
          processed_at?: string
          profile_id: string
          server_version?: number | null
        }
        Update: {
          action_type?: string
          assignment_id?: string
          client_base_version?: number
          client_occurred_at?: string
          client_sequence?: number
          conflict_detail?: Json
          device_id?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          outcome?: string
          payload?: Json
          payload_sha256?: string
          processed_at?: string
          profile_id?: string
          server_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_receipts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "course_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_receipts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "offline_device_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_receipts_profile_id_fkey"
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
      open_shift_claims: {
        Row: {
          claim_status: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          eligibility_decision_id: string
          employee_id: string
          id: string
          opportunity_id: string
          organization_id: string
          requested_at: string
          shift_assignment_id: string | null
          waitlist_position: number | null
        }
        Insert: {
          claim_status: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          eligibility_decision_id: string
          employee_id: string
          id?: string
          opportunity_id: string
          organization_id: string
          requested_at?: string
          shift_assignment_id?: string | null
          waitlist_position?: number | null
        }
        Update: {
          claim_status?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          eligibility_decision_id?: string
          employee_id?: string
          id?: string
          opportunity_id?: string
          organization_id?: string
          requested_at?: string
          shift_assignment_id?: string | null
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "open_shift_claims_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_claims_eligibility_decision_id_fkey"
            columns: ["eligibility_decision_id"]
            isOneToOne: false
            referencedRelation: "schedule_eligibility_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_claims_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "open_shift_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_claims_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      open_shift_opportunities: {
        Row: {
          claim_deadline: string
          created_at: string
          created_by: string
          end_time: string
          facility_id: string
          id: string
          organization_id: string
          required_credential_types: string[]
          required_qualification_keys: string[]
          required_training_type_ids: string[]
          schedule_id: string
          shift_date: string
          shift_definition_id: string | null
          slots: number
          start_time: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          claim_deadline: string
          created_at?: string
          created_by: string
          end_time: string
          facility_id: string
          id?: string
          organization_id: string
          required_credential_types?: string[]
          required_qualification_keys?: string[]
          required_training_type_ids?: string[]
          schedule_id: string
          shift_date: string
          shift_definition_id?: string | null
          slots?: number
          start_time: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          claim_deadline?: string
          created_at?: string
          created_by?: string
          end_time?: string
          facility_id?: string
          id?: string
          organization_id?: string
          required_credential_types?: string[]
          required_qualification_keys?: string[]
          required_training_type_ids?: string[]
          schedule_id?: string
          shift_date?: string
          shift_definition_id?: string | null
          slots?: number
          start_time?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_shift_opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_opportunities_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_opportunities_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_opportunities_shift_definition_id_fkey"
            columns: ["shift_definition_id"]
            isOneToOne: false
            referencedRelation: "shift_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_opportunities_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "facility_units"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_entitlement_grants: {
        Row: {
          approved_by: string | null
          contract_reference: string | null
          created_at: string
          created_by: string | null
          decision: string
          effective_from: string
          effective_to: string | null
          entitlement_value: Json | null
          feature_key: string
          id: string
          organization_id: string
          reason: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          decision: string
          effective_from?: string
          effective_to?: string | null
          entitlement_value?: Json | null
          feature_key: string
          id?: string
          organization_id: string
          reason: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string
          effective_from?: string
          effective_to?: string | null
          entitlement_value?: Json | null
          feature_key?: string
          id?: string
          organization_id?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_entitlement_grants_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_entitlement_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_entitlement_grants_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_definitions"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "organization_entitlement_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_identity_domains: {
        Row: {
          created_at: string
          created_by: string
          domain: string
          id: string
          organization_id: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          updated_at: string
          verification_challenge_sha256: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          domain: string
          id?: string
          organization_id: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          verification_challenge_sha256: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          domain?: string
          id?: string
          organization_id?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          verification_challenge_sha256?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_identity_domains_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_identity_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_identity_domains_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_identity_domains_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_release_cohorts: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          cohort_id: string
          created_at: string
          expires_at: string | null
          feature_key: string
          id: string
          organization_id: string
          reason: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          cohort_id: string
          created_at?: string
          expires_at?: string | null
          feature_key: string
          id?: string
          organization_id: string
          reason: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          cohort_id?: string
          created_at?: string
          expires_at?: string | null
          feature_key?: string
          id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_release_cohorts_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_release_cohorts_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "release_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_release_cohorts_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "release_flags"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "organization_release_cohorts_organization_id_fkey"
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
      organization_sso_connections: {
        Row: {
          created_at: string
          created_by: string
          default_role: string
          display_name: string
          id: string
          identity_domain_id: string
          issuer: string | null
          jit_membership_enabled: boolean
          jit_membership_policy: Json
          metadata_url: string | null
          organization_id: string
          provider: string
          provider_connection_id: string
          require_aal2: boolean
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_role?: string
          display_name: string
          id?: string
          identity_domain_id: string
          issuer?: string | null
          jit_membership_enabled?: boolean
          jit_membership_policy?: Json
          metadata_url?: string | null
          organization_id: string
          provider: string
          provider_connection_id: string
          require_aal2?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_role?: string
          display_name?: string
          id?: string
          identity_domain_id?: string
          issuer?: string | null
          jit_membership_enabled?: boolean
          jit_membership_policy?: Json
          metadata_url?: string | null
          organization_id?: string
          provider?: string
          provider_connection_id?: string
          require_aal2?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_sso_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sso_connections_identity_domain_id_fkey"
            columns: ["identity_domain_id"]
            isOneToOne: false
            referencedRelation: "organization_identity_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sso_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
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
          trial_ends_at: string | null
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
          trial_ends_at?: string | null
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
          trial_ends_at?: string | null
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
      package_billing_prices: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          interval_count: number
          is_active: boolean
          is_seat_based: boolean
          maximum_quantity: number | null
          minimum_quantity: number
          package_id: string
          recurring_interval: string
          stripe_price_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          is_seat_based?: boolean
          maximum_quantity?: number | null
          minimum_quantity?: number
          package_id: string
          recurring_interval: string
          stripe_price_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          is_seat_based?: boolean
          maximum_quantity?: number | null
          minimum_quantity?: number
          package_id?: string
          recurring_interval?: string
          stripe_price_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_billing_prices_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_entitlements: {
        Row: {
          contract_reference: string | null
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          entitlement_value: Json
          feature_key: string
          id: string
          package_id: string
          source: string
          updated_at: string
        }
        Insert: {
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          entitlement_value: Json
          feature_key: string
          id?: string
          package_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          entitlement_value?: Json
          feature_key?: string
          id?: string
          package_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_entitlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_entitlements_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_definitions"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "package_entitlements_package_id_fkey"
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
      permission_definitions: {
        Row: {
          created_at: string
          description: string
          is_active: boolean
          permission_key: string
          risk_level: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          is_active?: boolean
          permission_key: string
          risk_level?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          is_active?: boolean
          permission_key?: string
          risk_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      policy_audience_rules: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          exception_rule: Json
          id: string
          organization_id: string
          policy_document_id: string
          reminder_days: number[]
          requires_attestation: boolean
          requires_quiz: boolean
          target_id: string | null
          target_type: string
          target_value: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          exception_rule?: Json
          id?: string
          organization_id: string
          policy_document_id: string
          reminder_days?: number[]
          requires_attestation?: boolean
          requires_quiz?: boolean
          target_id?: string | null
          target_type: string
          target_value?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          exception_rule?: Json
          id?: string
          organization_id?: string
          policy_document_id?: string
          reminder_days?: number[]
          requires_attestation?: boolean
          requires_quiz?: boolean
          target_id?: string | null
          target_type?: string
          target_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "policy_audience_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_audience_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_audience_rules_policy_document_id_fkey"
            columns: ["policy_document_id"]
            isOneToOne: false
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_delivery_events: {
        Row: {
          audience_rule_id: string | null
          campaign_id: string | null
          employee_id: string
          event_type: string
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          policy_document_version_id: string
          provider_outcome: Json
        }
        Insert: {
          audience_rule_id?: string | null
          campaign_id?: string | null
          employee_id: string
          event_type: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          policy_document_version_id: string
          provider_outcome?: Json
        }
        Update: {
          audience_rule_id?: string | null
          campaign_id?: string | null
          employee_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          policy_document_version_id?: string
          provider_outcome?: Json
        }
        Relationships: [
          {
            foreignKeyName: "policy_delivery_events_audience_rule_id_fkey"
            columns: ["audience_rule_id"]
            isOneToOne: false
            referencedRelation: "policy_audience_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_delivery_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "policy_attestation_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_delivery_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_delivery_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_delivery_events_policy_document_version_id_fkey"
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
      policy_version_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_type: string
          linked_record_id: string
          organization_id: string
          policy_document_version_id: string
          rationale: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_type: string
          linked_record_id: string
          organization_id: string
          policy_document_version_id: string
          rationale: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          linked_record_id?: string
          organization_id?: string
          policy_document_version_id?: string
          rationale?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_version_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_version_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_version_links_policy_document_version_id_fkey"
            columns: ["policy_document_version_id"]
            isOneToOne: false
            referencedRelation: "policy_document_versions"
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
          email_opt_out: boolean
          email_opt_out_at: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          notification_timezone: string
          organization_id: string | null
          phone: string | null
          preferred_notification_channel: string
          role: string
          sms_consent_at: string | null
          sms_opt_in: boolean
          sms_opt_out_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          email_opt_out?: boolean
          email_opt_out_at?: string | null
          first_name?: string
          id: string
          is_active?: boolean
          last_name?: string
          notification_timezone?: string
          organization_id?: string | null
          phone?: string | null
          preferred_notification_channel?: string
          role?: string
          sms_consent_at?: string | null
          sms_opt_in?: boolean
          sms_opt_out_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          email_opt_out?: boolean
          email_opt_out_at?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          notification_timezone?: string
          organization_id?: string | null
          phone?: string | null
          preferred_notification_channel?: string
          role?: string
          sms_consent_at?: string | null
          sms_opt_in?: boolean
          sms_opt_out_at?: string | null
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
      qualification_lifecycle_events: {
        Row: {
          actor_profile_id: string | null
          employee_qualification_id: string
          event_type: string
          evidence: Json
          id: string
          occurred_at: string
          organization_id: string
          prior_state: string | null
          reason: string
          resulting_state: string
        }
        Insert: {
          actor_profile_id?: string | null
          employee_qualification_id: string
          event_type: string
          evidence?: Json
          id?: string
          occurred_at?: string
          organization_id: string
          prior_state?: string | null
          reason: string
          resulting_state: string
        }
        Update: {
          actor_profile_id?: string | null
          employee_qualification_id?: string
          event_type?: string
          evidence?: Json
          id?: string
          occurred_at?: string
          organization_id?: string
          prior_state?: string | null
          reason?: string
          resulting_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_lifecycle_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_lifecycle_events_employee_qualification_id_fkey"
            columns: ["employee_qualification_id"]
            isOneToOne: false
            referencedRelation: "employee_qualifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_lifecycle_events_organization_id_fkey"
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
<<<<<<< HEAD
=======
      regulatory_rule_fixture_runs: {
        Row: {
          actual_result_checksum_sha256: string
          engine_version: string
          executed_at: string
          executed_by: string | null
          failure_detail: string | null
          fixture_id: string
          id: string
          passed: boolean
          request_id: string
          rule_version_id: string
        }
        Insert: {
          actual_result_checksum_sha256: string
          engine_version: string
          executed_at?: string
          executed_by?: string | null
          failure_detail?: string | null
          fixture_id: string
          id?: string
          passed: boolean
          request_id: string
          rule_version_id: string
        }
        Update: {
          actual_result_checksum_sha256?: string
          engine_version?: string
          executed_at?: string
          executed_by?: string | null
          failure_detail?: string | null
          fixture_id?: string
          id?: string
          passed?: boolean
          request_id?: string
          rule_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_fixture_runs_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_fixture_runs_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_golden_fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_fixture_runs_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_golden_fixtures: {
        Row: {
          boundary_date: string
          created_at: string
          created_by: string
          expected_result: Json
          facility_type: string
          fixture_checksum_sha256: string
          fixture_key: string
          id: string
          input_payload: Json
          rule_version_id: string
          workforce_profile_key: string
        }
        Insert: {
          boundary_date: string
          created_at?: string
          created_by: string
          expected_result: Json
          facility_type: string
          fixture_checksum_sha256: string
          fixture_key: string
          id?: string
          input_payload: Json
          rule_version_id: string
          workforce_profile_key: string
        }
        Update: {
          boundary_date?: string
          created_at?: string
          created_by?: string
          expected_result?: Json
          facility_type?: string
          fixture_checksum_sha256?: string
          fixture_key?: string
          id?: string
          input_payload?: Json
          rule_version_id?: string
          workforce_profile_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_golden_fixtures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_golden_fixtures_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_packs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          owner_profile_id: string
          rule_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_profile_id: string
          rule_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_profile_id?: string
          rule_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_packs_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_shadow_differences: {
        Row: {
          baseline_result: Json | null
          candidate_result: Json | null
          created_at: string
          difference_checksum_sha256: string
          id: string
          shadow_run_id: string
          subject_reference: string
        }
        Insert: {
          baseline_result?: Json | null
          candidate_result?: Json | null
          created_at?: string
          difference_checksum_sha256: string
          id?: string
          shadow_run_id: string
          subject_reference: string
        }
        Update: {
          baseline_result?: Json | null
          candidate_result?: Json | null
          created_at?: string
          difference_checksum_sha256?: string
          id?: string
          shadow_run_id?: string
          subject_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_shadow_differences_shadow_run_id_fkey"
            columns: ["shadow_run_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_shadow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_shadow_reconciliations: {
        Row: {
          difference_id: string
          evidence_checksum_sha256: string
          id: string
          rationale: string
          reconciled_at: string
          reconciled_by: string
          resolution: string
        }
        Insert: {
          difference_id: string
          evidence_checksum_sha256: string
          id?: string
          rationale: string
          reconciled_at?: string
          reconciled_by: string
          resolution: string
        }
        Update: {
          difference_id?: string
          evidence_checksum_sha256?: string
          id?: string
          rationale?: string
          reconciled_at?: string
          reconciled_by?: string
          resolution?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_shadow_reconciliations_difference_id_fkey"
            columns: ["difference_id"]
            isOneToOne: true
            referencedRelation: "regulatory_rule_shadow_differences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_shadow_reconciliations_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_shadow_runs: {
        Row: {
          baseline_version_id: string | null
          cohort_ended_at: string
          cohort_started_at: string
          completed_at: string
          created_at: string
          difference_count: number
          engine_version: string
          evaluated_count: number
          facility_type: string
          id: string
          organization_id: string
          recorded_by: string | null
          request_id: string
          result_checksum_sha256: string
          rule_version_id: string
        }
        Insert: {
          baseline_version_id?: string | null
          cohort_ended_at: string
          cohort_started_at: string
          completed_at?: string
          created_at?: string
          difference_count: number
          engine_version: string
          evaluated_count: number
          facility_type: string
          id?: string
          organization_id: string
          recorded_by?: string | null
          request_id: string
          result_checksum_sha256: string
          rule_version_id: string
        }
        Update: {
          baseline_version_id?: string | null
          cohort_ended_at?: string
          cohort_started_at?: string
          completed_at?: string
          created_at?: string
          difference_count?: number
          engine_version?: string
          evaluated_count?: number
          facility_type?: string
          id?: string
          organization_id?: string
          recorded_by?: string | null
          request_id?: string
          result_checksum_sha256?: string
          rule_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_shadow_runs_baseline_version_id_fkey"
            columns: ["baseline_version_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_shadow_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_shadow_runs_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_shadow_runs_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rule_versions: {
        Row: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          activated_at?: string | null
          applicability?: Json
          approved_at?: string | null
          authored_by: string
          authority_name: string
          calculation_parameters?: Json
          citation: string
          content_checksum_sha256: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          jurisdiction_code: string
          release_notes: string
          review_notes?: string | null
          reviewed_by?: string | null
          rule_pack_id: string
          shadow_started_at?: string | null
          source_checksum_sha256: string
          source_uri?: string | null
          state?: string
          submitted_at?: string | null
          submitted_by?: string | null
          superseded_at?: string | null
          supersedes_version_id?: string | null
          updated_at?: string
          version_number: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          activated_at?: string | null
          applicability?: Json
          approved_at?: string | null
          authored_by?: string
          authority_name?: string
          calculation_parameters?: Json
          citation?: string
          content_checksum_sha256?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          jurisdiction_code?: string
          release_notes?: string
          review_notes?: string | null
          reviewed_by?: string | null
          rule_pack_id?: string
          shadow_started_at?: string | null
          source_checksum_sha256?: string
          source_uri?: string | null
          state?: string
          submitted_at?: string | null
          submitted_by?: string | null
          superseded_at?: string | null
          supersedes_version_id?: string | null
          updated_at?: string
          version_number?: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_rule_versions_authored_by_fkey"
            columns: ["authored_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_versions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_versions_rule_pack_id_fkey"
            columns: ["rule_pack_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_versions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "regulatory_rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_rule_versions_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      release_cohorts: {
        Row: {
          cohort_key: string
          created_at: string
          created_by: string | null
          description: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          cohort_key: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          cohort_key?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_cohorts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      release_flags: {
        Row: {
          change_reason: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          feature_key: string
          is_enabled: boolean
          owner: string
          rollout_mode: string
          updated_at: string
        }
        Insert: {
          change_reason: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          feature_key: string
          is_enabled?: boolean
          owner: string
          rollout_mode?: string
          updated_at?: string
        }
        Update: {
          change_reason?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          feature_key?: string
          is_enabled?: boolean
          owner?: string
          rollout_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_flags_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: true
            referencedRelation: "feature_definitions"
            referencedColumns: ["feature_key"]
          },
        ]
      }
      report_schedules: {
        Row: {
          audience: Json
          created_at: string
          created_by: string | null
          cron_expression: string
          delivery_mode: string
          enabled: boolean
          id: string
          last_run_at: string | null
          next_run_at: string | null
          organization_id: string
          report_definition_id: string
          report_version_id: string
          retention_days: number
          time_zone: string
        }
        Insert: {
          audience: Json
          created_at?: string
          created_by?: string | null
          cron_expression: string
          delivery_mode: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id: string
          report_definition_id: string
          report_version_id: string
          retention_days: number
          time_zone: string
        }
        Update: {
          audience?: Json
          created_at?: string
          created_by?: string | null
          cron_expression?: string
          delivery_mode?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id?: string
          report_definition_id?: string
          report_version_id?: string
          retention_days?: number
          time_zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "saved_report_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_report_version_id_fkey"
            columns: ["report_version_id"]
            isOneToOne: false
            referencedRelation: "saved_report_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_snapshot_artifacts: {
        Row: {
          artifact_type: string
          byte_size: number
          content_sha256: string
          created_at: string
          facility_id: string | null
          id: string
          manifest: Json
          organization_id: string
          snapshot_id: string
          storage_bucket: string
          storage_path: string
          watermark_template: string | null
          withdrawn_at: string | null
        }
        Insert: {
          artifact_type: string
          byte_size: number
          content_sha256: string
          created_at?: string
          facility_id?: string | null
          id?: string
          manifest: Json
          organization_id: string
          snapshot_id: string
          storage_bucket: string
          storage_path: string
          watermark_template?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          artifact_type?: string
          byte_size?: number
          content_sha256?: string
          created_at?: string
          facility_id?: string | null
          id?: string
          manifest?: Json
          organization_id?: string
          snapshot_id?: string
          storage_bucket?: string
          storage_path?: string
          watermark_template?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_snapshot_artifacts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshot_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshot_artifacts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      report_snapshots: {
        Row: {
          as_of: string
          configuration: Json
          configuration_sha256: string
          facility_id: string | null
          generated_at: string
          generated_by: string | null
          id: string
          included_record_ids: Json
          material_totals: Json
          organization_id: string
          reconciliation_detail: Json
          reconciliation_status: string
          report_definition_id: string
          report_version_id: string
          row_counts: Json
          snapshot_sha256: string
          source_watermarks: Json
          status: string
        }
        Insert: {
          as_of: string
          configuration: Json
          configuration_sha256: string
          facility_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          included_record_ids: Json
          material_totals?: Json
          organization_id: string
          reconciliation_detail?: Json
          reconciliation_status: string
          report_definition_id: string
          report_version_id: string
          row_counts: Json
          snapshot_sha256: string
          source_watermarks?: Json
          status?: string
        }
        Update: {
          as_of?: string
          configuration?: Json
          configuration_sha256?: string
          facility_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          included_record_ids?: Json
          material_totals?: Json
          organization_id?: string
          reconciliation_detail?: Json
          reconciliation_status?: string
          report_definition_id?: string
          report_version_id?: string
          row_counts?: Json
          snapshot_sha256?: string
          source_watermarks?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_snapshots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshots_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshots_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "saved_report_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_snapshots_report_version_id_fkey"
            columns: ["report_version_id"]
            isOneToOne: false
            referencedRelation: "saved_report_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_assessment_ai_generations: {
        Row: {
          created_at: string
          error_message: string | null
          facility_id: string
          id: string
          model: string
          organization_id: string
          request_params: Json
          requested_by: string
          resident_assessment_form_id: string
          response_summary: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          facility_id: string
          id?: string
          model: string
          organization_id: string
          request_params: Json
          requested_by: string
          resident_assessment_form_id: string
          response_summary?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          facility_id?: string
          id?: string
          model?: string
          organization_id?: string
          request_params?: Json
          requested_by?: string
          resident_assessment_form_id?: string
          response_summary?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_assessment_ai_generations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_ai_generations_form_fkey"
            columns: ["resident_assessment_form_id"]
            isOneToOne: false
            referencedRelation: "resident_assessment_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_ai_generations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_ai_generations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
>>>>>>> origin/main
      resident_assessment_forms: {
        Row: {
          cloned_from_id: string | null
          compliance_item_id: string | null
          content: Json
          created_at: string
          facility_id: string
          finalized_at: string | null
          form_type: string
          id: string
          organization_id: string
          prepared_by_name: string | null
          prepared_by_profile_id: string | null
          prepared_by_title: string | null
          prepared_date: string | null
          reason: string
          resident_id: string
          schema_version: number
          status: string
          superseded_by_id: string | null
          updated_at: string
          version_number: number
        }
        Insert: {
          cloned_from_id?: string | null
          compliance_item_id?: string | null
          content?: Json
          created_at?: string
          facility_id: string
          finalized_at?: string | null
          form_type: string
          id?: string
          organization_id: string
          prepared_by_name?: string | null
          prepared_by_profile_id?: string | null
          prepared_by_title?: string | null
          prepared_date?: string | null
          reason: string
          resident_id: string
          schema_version?: number
          status?: string
          superseded_by_id?: string | null
          updated_at?: string
          version_number?: number
        }
        Update: {
          cloned_from_id?: string | null
          compliance_item_id?: string | null
          content?: Json
          created_at?: string
          facility_id?: string
          finalized_at?: string | null
          form_type?: string
          id?: string
          organization_id?: string
          prepared_by_name?: string | null
          prepared_by_profile_id?: string | null
          prepared_by_title?: string | null
          prepared_date?: string | null
          reason?: string
          resident_id?: string
          schema_version?: number
          status?: string
          superseded_by_id?: string | null
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "resident_assessment_forms_cloned_from_id_fkey"
            columns: ["cloned_from_id"]
            isOneToOne: false
            referencedRelation: "resident_assessment_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_compliance_item_id_fkey"
            columns: ["compliance_item_id"]
            isOneToOne: false
            referencedRelation: "resident_compliance_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_prepared_by_profile_id_fkey"
            columns: ["prepared_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_assessment_forms_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "resident_assessment_forms"
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
          grace_period_days: number
          id: string
          item_type: string
          notes: string | null
          organization_id: string
          renewal_interval_days: number | null
          resident_id: string
          status: string
          triggered_by_item_id: string | null
          updated_at: string
          warning_days: number
        }
        Insert: {
          citation_topic_id?: string | null
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          facility_id: string
          grace_period_days?: number
          id?: string
          item_type: string
          notes?: string | null
          organization_id: string
          renewal_interval_days?: number | null
          resident_id: string
          status?: string
          triggered_by_item_id?: string | null
          updated_at?: string
          warning_days?: number
        }
        Update: {
          citation_topic_id?: string | null
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          facility_id?: string
          grace_period_days?: number
          id?: string
          item_type?: string
          notes?: string | null
          organization_id?: string
          renewal_interval_days?: number | null
          resident_id?: string
          status?: string
          triggered_by_item_id?: string | null
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
          {
            foreignKeyName: "resident_compliance_items_triggered_by_item_id_fkey"
            columns: ["triggered_by_item_id"]
            isOneToOne: false
            referencedRelation: "resident_compliance_items"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_compliance_rule_packs: {
        Row: {
          admission_track: string
          citation_ref: string | null
          created_at: string
          facility_type: string
          grace_period_days: number
          id: string
          is_active: boolean
          item_type: string
          notes: string | null
          offset_basis: string
          offset_days: number
          organization_id: string | null
          renewal_interval_days: number | null
          state: string
          warning_days: number
        }
        Insert: {
          admission_track?: string
          citation_ref?: string | null
          created_at?: string
          facility_type: string
          grace_period_days?: number
          id?: string
          is_active?: boolean
          item_type: string
          notes?: string | null
          offset_basis: string
          offset_days: number
          organization_id?: string | null
          renewal_interval_days?: number | null
          state?: string
          warning_days?: number
        }
        Update: {
          admission_track?: string
          citation_ref?: string | null
          created_at?: string
          facility_type?: string
          grace_period_days?: number
          id?: string
          is_active?: boolean
          item_type?: string
          notes?: string | null
          offset_basis?: string
          offset_days?: number
          organization_id?: string | null
          renewal_interval_days?: number | null
          state?: string
          warning_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "resident_compliance_rule_packs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          is_state_form: boolean
          organization_id: string
          resident_id: string
          state_form_source_label: string | null
          state_form_source_url: string | null
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
          is_state_form?: boolean
          organization_id: string
          resident_id: string
          state_form_source_label?: string | null
          state_form_source_url?: string | null
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
          is_state_form?: boolean
          organization_id?: string
          resident_id?: string
          state_form_source_label?: string | null
          state_form_source_url?: string | null
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
      resident_informal_supports: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          name: string
          organization_id: string
          phone: string | null
          relationship: string | null
          resident_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          relationship?: string | null
          resident_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          relationship?: string | null
          resident_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_informal_supports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_informal_supports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_informal_supports_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      residents: {
        Row: {
          admission_date: string
          admission_track: string
          case_manager_name: string | null
          case_manager_phone: string | null
          created_at: string
          date_of_birth: string | null
          dentist_name: string | null
          dentist_phone: string | null
          designated_person_name: string | null
          discharge_date: string | null
          facility_id: string
          first_name: string
          hospice: boolean
          id: string
          last_name: string
          organization_id: string
          primary_physician_name: string | null
          primary_physician_phone: string | null
          room: string | null
          sdcu: boolean
          status: string
          updated_at: string
        }
        Insert: {
          admission_date: string
          admission_track?: string
          case_manager_name?: string | null
          case_manager_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          dentist_name?: string | null
          dentist_phone?: string | null
          designated_person_name?: string | null
          discharge_date?: string | null
          facility_id: string
          first_name: string
          hospice?: boolean
          id?: string
          last_name: string
          organization_id: string
          primary_physician_name?: string | null
          primary_physician_phone?: string | null
          room?: string | null
          sdcu?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          admission_date?: string
          admission_track?: string
          case_manager_name?: string | null
          case_manager_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          dentist_name?: string | null
          dentist_phone?: string | null
          designated_person_name?: string | null
          discharge_date?: string | null
          facility_id?: string
          first_name?: string
          hospice?: boolean
          id?: string
          last_name?: string
          organization_id?: string
          primary_physician_name?: string | null
          primary_physician_phone?: string | null
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
      role_template_permissions: {
        Row: {
          created_at: string
          permission_key: string
          role_template_id: string
        }
        Insert: {
          created_at?: string
          permission_key: string
          role_template_id: string
        }
        Update: {
          created_at?: string
          permission_key?: string
          role_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_template_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permission_definitions"
            referencedColumns: ["permission_key"]
          },
          {
            foreignKeyName: "role_template_permissions_role_template_id_fkey"
            columns: ["role_template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      role_templates: {
        Row: {
          built_in_role: string | null
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          is_system_managed: boolean
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          built_in_role?: string | null
          code: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_system_managed?: boolean
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          built_in_role?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_system_managed?: boolean
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_report_definitions: {
        Row: {
          audience_roles: string[]
          created_at: string
          current_version_id: string | null
          entitlement_key: string | null
          id: string
          name: string
          organization_id: string
          owner_profile_id: string | null
          report_type: string
          retention_days: number
          schedule_enabled: boolean
          updated_at: string
        }
        Insert: {
          audience_roles?: string[]
          created_at?: string
          current_version_id?: string | null
          entitlement_key?: string | null
          id?: string
          name: string
          organization_id: string
          owner_profile_id?: string | null
          report_type: string
          retention_days?: number
          schedule_enabled?: boolean
          updated_at?: string
        }
        Update: {
          audience_roles?: string[]
          created_at?: string
          current_version_id?: string | null
          entitlement_key?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_profile_id?: string | null
          report_type?: string
          retention_days?: number
          schedule_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_report_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "saved_report_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_report_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_report_definitions_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_report_versions: {
        Row: {
          columns: Json
          configuration_sha256: string
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          organization_id: string
          published_at: string | null
          report_definition_id: string
          sort_spec: Json
          state: string
          time_zone: string
          version_number: number
        }
        Insert: {
          columns?: Json
          configuration_sha256: string
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          organization_id: string
          published_at?: string | null
          report_definition_id: string
          sort_spec?: Json
          state?: string
          time_zone?: string
          version_number: number
        }
        Update: {
          columns?: Json
          configuration_sha256?: string
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          organization_id?: string
          published_at?: string | null
          report_definition_id?: string
          sort_spec?: Json
          state?: string
          time_zone?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "saved_report_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_report_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_report_versions_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "saved_report_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_eligibility_decisions: {
        Row: {
          applied_override_ids: string[]
          decision_context: string
          employee_id: string
          evaluated_at: string
          evaluated_by: string | null
          evaluated_for_end: string
          evaluated_for_start: string
          facility_id: string
          hard_blocks: string[]
          id: string
          organization_id: string
          outcome: string
          source_checksum_sha256: string
          source_snapshot: Json
          target_id: string | null
          target_type: string
          warnings: string[]
        }
        Insert: {
          applied_override_ids?: string[]
          decision_context: string
          employee_id: string
          evaluated_at?: string
          evaluated_by?: string | null
          evaluated_for_end: string
          evaluated_for_start: string
          facility_id: string
          hard_blocks?: string[]
          id?: string
          organization_id: string
          outcome: string
          source_checksum_sha256: string
          source_snapshot: Json
          target_id?: string | null
          target_type: string
          warnings?: string[]
        }
        Update: {
          applied_override_ids?: string[]
          decision_context?: string
          employee_id?: string
          evaluated_at?: string
          evaluated_by?: string | null
          evaluated_for_end?: string
          evaluated_for_start?: string
          facility_id?: string
          hard_blocks?: string[]
          id?: string
          organization_id?: string
          outcome?: string
          source_checksum_sha256?: string
          source_snapshot?: Json
          target_id?: string | null
          target_type?: string
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "schedule_eligibility_decisions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_decisions_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_decisions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_eligibility_overrides: {
        Row: {
          authority_reference: string
          block_code: string
          created_at: string
          effective_from: string
          employee_id: string
          expires_at: string
          facility_id: string
          granted_by: string
          id: string
          organization_id: string
          reason: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope_id: string | null
          scope_type: string
        }
        Insert: {
          authority_reference: string
          block_code: string
          created_at?: string
          effective_from?: string
          employee_id: string
          expires_at: string
          facility_id: string
          granted_by: string
          id?: string
          organization_id: string
          reason: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_id?: string | null
          scope_type: string
        }
        Update: {
          authority_reference?: string
          block_code?: string
          created_at?: string
          effective_from?: string
          employee_id?: string
          expires_at?: string
          facility_id?: string
          granted_by?: string
          id?: string
          organization_id?: string
          reason?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_id?: string | null
          scope_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_eligibility_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_overrides_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_overrides_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_overrides_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_eligibility_policies: {
        Row: {
          claim_deadline_hours: number
          created_at: string
          manager_approval_required: boolean
          max_weekly_hours: number
          minimum_rest_hours: number
          organization_id: string
          swap_deadline_hours: number
          updated_at: string
          updated_by: string | null
          waitlist_enabled: boolean
          warning_weekly_hours: number
        }
        Insert: {
          claim_deadline_hours?: number
          created_at?: string
          manager_approval_required?: boolean
          max_weekly_hours?: number
          minimum_rest_hours?: number
          organization_id: string
          swap_deadline_hours?: number
          updated_at?: string
          updated_by?: string | null
          waitlist_enabled?: boolean
          warning_weekly_hours?: number
        }
        Update: {
          claim_deadline_hours?: number
          created_at?: string
          manager_approval_required?: boolean
          max_weekly_hours?: number
          minimum_rest_hours?: number
          organization_id?: string
          swap_deadline_hours?: number
          updated_at?: string
          updated_by?: string | null
          waitlist_enabled?: boolean
          warning_weekly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_eligibility_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_eligibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string
          id: string
          organization_id: string
          period_end: string
          period_start: string
          published_at: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id: string
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          published_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          published_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_connections: {
        Row: {
          connection_key: string
          created_at: string
          created_by: string
          credential_hash_sha256: string
          credential_hint: string
          credential_salt: string
          default_facility_id: string
          display_name: string
          id: string
          last_rotated_at: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          connection_key?: string
          created_at?: string
          created_by: string
          credential_hash_sha256: string
          credential_hint: string
          credential_salt: string
          default_facility_id: string
          display_name: string
          id?: string
          last_rotated_at?: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          connection_key?: string
          created_at?: string
          created_by?: string
          credential_hash_sha256?: string
          credential_hint?: string
          credential_salt?: string
          default_facility_id?: string
          display_name?: string
          id?: string
          last_rotated_at?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_connections_default_facility_id_fkey"
            columns: ["default_facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_group_mappings: {
        Row: {
          app_role: string
          created_at: string
          external_group_id: string
          facility_id: string | null
          id: string
          job_title: string | null
          priority: number
          scim_connection_id: string
        }
        Insert: {
          app_role?: string
          created_at?: string
          external_group_id: string
          facility_id?: string | null
          id?: string
          job_title?: string | null
          priority?: number
          scim_connection_id: string
        }
        Update: {
          app_role?: string
          created_at?: string
          external_group_id?: string
          facility_id?: string | null
          id?: string
          job_title?: string | null
          priority?: number
          scim_connection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_group_mappings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_group_mappings_scim_connection_id_fkey"
            columns: ["scim_connection_id"]
            isOneToOne: false
            referencedRelation: "scim_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_request_receipts: {
        Row: {
          completed_at: string | null
          created_at: string
          employee_id: string | null
          error_code: string | null
          external_subject_id: string
          id: string
          identity_id: string | null
          operation: string
          organization_id: string
          payload_sha256: string
          request_id: string
          response_body: Json | null
          scim_connection_id: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          employee_id?: string | null
          error_code?: string | null
          external_subject_id: string
          id?: string
          identity_id?: string | null
          operation: string
          organization_id: string
          payload_sha256: string
          request_id: string
          response_body?: Json | null
          scim_connection_id: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          employee_id?: string | null
          error_code?: string | null
          external_subject_id?: string
          id?: string
          identity_id?: string | null
          operation?: string
          organization_id?: string
          payload_sha256?: string
          request_id?: string
          response_body?: Json | null
          scim_connection_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_request_receipts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_request_receipts_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "scim_subject_links"
            referencedColumns: ["identity_id"]
          },
          {
            foreignKeyName: "scim_request_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_request_receipts_scim_connection_id_fkey"
            columns: ["scim_connection_id"]
            isOneToOne: false
            referencedRelation: "scim_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_subject_links: {
        Row: {
          created_at: string
          deprovisioned_at: string | null
          employee_id: string
          external_subject_id: string
          identity_id: string
          last_request_id: string
          lifecycle_state: string
          organization_id: string
          profile_id: string | null
          scim_connection_id: string
          suspended_at: string | null
          updated_at: string
          user_name: string
        }
        Insert: {
          created_at?: string
          deprovisioned_at?: string | null
          employee_id: string
          external_subject_id: string
          identity_id?: string
          last_request_id: string
          lifecycle_state?: string
          organization_id: string
          profile_id?: string | null
          scim_connection_id: string
          suspended_at?: string | null
          updated_at?: string
          user_name: string
        }
        Update: {
          created_at?: string
          deprovisioned_at?: string | null
          employee_id?: string
          external_subject_id?: string
          identity_id?: string
          last_request_id?: string
          lifecycle_state?: string
          organization_id?: string
          profile_id?: string | null
          scim_connection_id?: string
          suspended_at?: string | null
          updated_at?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_subject_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_subject_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_subject_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_subject_links_scim_connection_id_fkey"
            columns: ["scim_connection_id"]
            isOneToOne: false
            referencedRelation: "scim_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          created_at: string
          employee_id: string
          end_time: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          schedule_id: string
          shift_date: string
          shift_definition_id: string | null
          source: string
          start_time: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_time: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          schedule_id: string
          shift_date: string
          shift_definition_id?: string | null
          source?: string
          start_time: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_time?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          schedule_id?: string
          shift_date?: string
          shift_definition_id?: string | null
          source?: string
          start_time?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_definition_id_fkey"
            columns: ["shift_definition_id"]
            isOneToOne: false
            referencedRelation: "shift_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "facility_units"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_definitions: {
        Row: {
          color: string | null
          created_at: string
          end_time: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
          start_time: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          end_time: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          end_time?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_definitions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_eligibility_requirements: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          organization_id: string
          required_credential_types: string[]
          required_qualification_keys: string[]
          required_training_type_ids: string[]
          shift_definition_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          organization_id: string
          required_credential_types?: string[]
          required_qualification_keys?: string[]
          required_training_type_ids?: string[]
          shift_definition_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          required_credential_types?: string[]
          required_qualification_keys?: string[]
          required_training_type_ids?: string[]
          shift_definition_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_eligibility_requirements_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_eligibility_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_eligibility_requirements_shift_definition_id_fkey"
            columns: ["shift_definition_id"]
            isOneToOne: false
            referencedRelation: "shift_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_eligibility_requirements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          expires_at: string
          facility_id: string
          id: string
          organization_id: string
          reason: string
          requested_at: string
          requester_assignment_id: string
          requester_decision_id: string | null
          requester_employee_id: string
          status: string
          target_assignment_id: string
          target_decision_id: string | null
          target_employee_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expires_at: string
          facility_id: string
          id?: string
          organization_id: string
          reason: string
          requested_at?: string
          requester_assignment_id: string
          requester_decision_id?: string | null
          requester_employee_id: string
          status?: string
          target_assignment_id: string
          target_decision_id?: string | null
          target_employee_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expires_at?: string
          facility_id?: string
          id?: string
          organization_id?: string
          reason?: string
          requested_at?: string
          requester_assignment_id?: string
          requester_decision_id?: string | null
          requester_employee_id?: string
          status?: string
          target_assignment_id?: string
          target_decision_id?: string | null
          target_employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_assignment_id_fkey"
            columns: ["requester_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_decision_id_fkey"
            columns: ["requester_decision_id"]
            isOneToOne: false
            referencedRelation: "schedule_eligibility_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_assignment_id_fkey"
            columns: ["target_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_decision_id_fkey"
            columns: ["target_decision_id"]
            isOneToOne: false
            referencedRelation: "schedule_eligibility_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_attempts: {
        Row: {
          created_at: string
          email_hash: string
          error_code: string | null
          id: string
          ip_hash: string
          success: boolean
        }
        Insert: {
          created_at?: string
          email_hash: string
          error_code?: string | null
          id?: string
          ip_hash: string
          success?: boolean
        }
        Update: {
          created_at?: string
          email_hash?: string
          error_code?: string | null
          id?: string
          ip_hash?: string
          success?: boolean
        }
        Relationships: []
      }
      support_ticket_messages: {
        Row: {
          attachment_bucket: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          attachment_type: string | null
          body: string
          created_at: string
          id: string
          is_admin_reply: boolean
          organization_id: string
          sender_id: string
          ticket_id: string
        }
        Insert: {
          attachment_bucket?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          body: string
          created_at?: string
          id?: string
          is_admin_reply?: boolean
          organization_id: string
          sender_id: string
          ticket_id: string
        }
        Update: {
          attachment_bucket?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          body?: string
          created_at?: string
          id?: string
          is_admin_reply?: boolean
          organization_id?: string
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          created_by: string
          id: string
          last_message_at: string
          organization_id: string
          priority: string
          resolved_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by: string
          id?: string
          last_message_at?: string
          organization_id: string
          priority?: string
          resolved_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          organization_id?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_attendance_evidence: {
        Row: {
          attendance_status: string
          attendee_signature_sha256: string | null
          check_in_at: string | null
          check_out_at: string | null
          evidence: Json
          evidence_checksum_sha256: string
          facility_id: string
          id: string
          organization_id: string
          recorded_at: string
          recorded_by: string
          recorder_signature_sha256: string
          registration_id: string
          seat_minutes: number | null
        }
        Insert: {
          attendance_status: string
          attendee_signature_sha256?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          evidence?: Json
          evidence_checksum_sha256: string
          facility_id: string
          id?: string
          organization_id: string
          recorded_at?: string
          recorded_by: string
          recorder_signature_sha256: string
          registration_id: string
          seat_minutes?: number | null
        }
        Update: {
          attendance_status?: string
          attendee_signature_sha256?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          evidence?: Json
          evidence_checksum_sha256?: string
          facility_id?: string
          id?: string
          organization_id?: string
          recorded_at?: string
          recorded_by?: string
          recorder_signature_sha256?: string
          registration_id?: string
          seat_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_attendance_evidence_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_attendance_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_attendance_evidence_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_attendance_evidence_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "training_session_registrations"
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
          lifecycle_disposition: string
          lifecycle_dispositioned_at: string | null
          lifecycle_event_id: string | null
          lifecycle_reason: string | null
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
          lifecycle_disposition?: string
          lifecycle_dispositioned_at?: string | null
          lifecycle_event_id?: string | null
          lifecycle_reason?: string | null
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
          lifecycle_disposition?: string
          lifecycle_dispositioned_at?: string | null
          lifecycle_event_id?: string | null
          lifecycle_reason?: string | null
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
            foreignKeyName: "training_class_attendees_lifecycle_event_id_fkey"
            columns: ["lifecycle_event_id"]
            isOneToOne: false
            referencedRelation: "employment_lifecycle_events"
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
          cancellation_reason: string | null
          capacity: number
          class_date: string
          class_name: string
          completion_approved_at: string | null
          completion_approved_by: string | null
          created_at: string
          duration_hours: number
          ends_at: string | null
          facility_id: string | null
          id: string
          location: string | null
          lock_version: number
          makeup_of_class_id: string | null
          notes: string | null
          organization_id: string
          rescheduled_to_class_id: string | null
          resource_requirements: Json
          room_name: string | null
          roster_document_id: string | null
          starts_at: string | null
          status: string
          trainer_profile_id: string
          training_type_id: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          capacity?: number
          class_date: string
          class_name: string
          completion_approved_at?: string | null
          completion_approved_by?: string | null
          created_at?: string
          duration_hours?: number
          ends_at?: string | null
          facility_id?: string | null
          id?: string
          location?: string | null
          lock_version?: number
          makeup_of_class_id?: string | null
          notes?: string | null
          organization_id: string
          rescheduled_to_class_id?: string | null
          resource_requirements?: Json
          room_name?: string | null
          roster_document_id?: string | null
          starts_at?: string | null
          status?: string
          trainer_profile_id: string
          training_type_id: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          capacity?: number
          class_date?: string
          class_name?: string
          completion_approved_at?: string | null
          completion_approved_by?: string | null
          created_at?: string
          duration_hours?: number
          ends_at?: string | null
          facility_id?: string | null
          id?: string
          location?: string | null
          lock_version?: number
          makeup_of_class_id?: string | null
          notes?: string | null
          organization_id?: string
          rescheduled_to_class_id?: string | null
          resource_requirements?: Json
          room_name?: string | null
          roster_document_id?: string | null
          starts_at?: string | null
          status?: string
          trainer_profile_id?: string
          training_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_classes_completion_approved_by_fkey"
            columns: ["completion_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_classes_makeup_of_class_id_fkey"
            columns: ["makeup_of_class_id"]
            isOneToOne: false
            referencedRelation: "training_classes"
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
            foreignKeyName: "training_classes_rescheduled_to_class_id_fkey"
            columns: ["rescheduled_to_class_id"]
            isOneToOne: false
            referencedRelation: "training_classes"
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
      training_session_completion_receipts: {
        Row: {
          approved_at: string
          approved_by: string
          attendee_count: number
          class_id: string
          evidence_checksum_sha256: string
          id: string
          organization_id: string
          training_record_count: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          attendee_count: number
          class_id: string
          evidence_checksum_sha256: string
          id?: string
          organization_id: string
          training_record_count: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          attendee_count?: number
          class_id?: string
          evidence_checksum_sha256?: string
          id?: string
          organization_id?: string
          training_record_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_session_completion_receipts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_completion_receipts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: true
            referencedRelation: "training_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_completion_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_session_registrations: {
        Row: {
          attendance_recorded_at: string | null
          canceled_at: string | null
          cancellation_reason: string | null
          class_id: string
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          organization_id: string
          registered_at: string
          registered_by: string | null
          registration_source: string
          registration_status: string
          training_record_id: string | null
          updated_at: string
          waitlist_position: number | null
        }
        Insert: {
          attendance_recorded_at?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          class_id: string
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          organization_id: string
          registered_at?: string
          registered_by?: string | null
          registration_source: string
          registration_status: string
          training_record_id?: string | null
          updated_at?: string
          waitlist_position?: number | null
        }
        Update: {
          attendance_recorded_at?: string | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          class_id?: string
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          registered_at?: string
          registered_by?: string | null
          registration_source?: string
          registration_status?: string
          training_record_id?: string | null
          updated_at?: string
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_session_registrations_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "training_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_registrations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_registrations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_registrations_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_registrations_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "employee_training_records"
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
      work_item_comments: {
        Row: {
          author_profile_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          visibility: string
          work_item_id: string
        }
        Insert: {
          author_profile_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          visibility?: string
          work_item_id: string
        }
        Update: {
          author_profile_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          visibility?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_comments_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_dependencies: {
        Row: {
          created_at: string
          dependency_type: string
          depends_on_work_item_id: string
          id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          dependency_type?: string
          depends_on_work_item_id: string
          id?: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: string
          depends_on_work_item_id?: string
          id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_dependencies_depends_on_work_item_id_fkey"
            columns: ["depends_on_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_dependencies_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_evidence: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content_sha256: string | null
          created_at: string
          evidence_type: string
          facility_id: string
          id: string
          linked_record_id: string | null
          linked_record_type: string | null
          organization_id: string
          storage_bucket: string | null
          storage_path: string | null
          submitted_by: string | null
          work_item_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content_sha256?: string | null
          created_at?: string
          evidence_type: string
          facility_id: string
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          organization_id: string
          storage_bucket?: string | null
          storage_path?: string | null
          submitted_by?: string | null
          work_item_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content_sha256?: string | null
          created_at?: string
          evidence_type?: string
          facility_id?: string
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          organization_id?: string
          storage_bucket?: string | null
          storage_path?: string | null
          submitted_by?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_evidence_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_evidence_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_evidence_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_evidence_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_history: {
        Row: {
          actor_profile_id: string | null
          event_type: string
          evidence: Json
          facility_id: string
          id: string
          occurred_at: string
          organization_id: string
          prior_state: string | null
          reason: string
          resulting_state: string | null
          work_item_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          event_type: string
          evidence?: Json
          facility_id: string
          id?: string
          occurred_at?: string
          organization_id: string
          prior_state?: string | null
          reason: string
          resulting_state?: string | null
          work_item_id: string
        }
        Update: {
          actor_profile_id?: string | null
          event_type?: string
          evidence?: Json
          facility_id?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          prior_state?: string | null
          reason?: string
          resulting_state?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_history_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_history_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_history_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_templates: {
        Row: {
          approval_required: boolean
          created_at: string
          created_by: string | null
          default_owner_role: string | null
          default_priority: string
          due_interval: string
          escalation_after: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          required_evidence_types: string[]
          source_type: string
          state_machine: Json
          template_key: string
          updated_at: string
        }
        Insert: {
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          default_owner_role?: string | null
          default_priority?: string
          due_interval?: string
          escalation_after?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          required_evidence_types?: string[]
          source_type: string
          state_machine?: Json
          template_key: string
          updated_at?: string
        }
        Update: {
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          default_owner_role?: string | null
          default_priority?: string
          due_interval?: string
          escalation_after?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          required_evidence_types?: string[]
          source_type?: string
          state_machine?: Json
          template_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_watchers: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_watchers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_watchers_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          closure_reason: string | null
          created_at: string
          created_by: string | null
          deduplication_key: string
          description: string | null
          due_at: string
          effectiveness_result: string | null
          effectiveness_review_due_at: string | null
          escalated_at: string | null
          facility_id: string
          id: string
          organization_id: string
          owner_profile_id: string | null
          priority: string
          recurrence_key: string | null
          recurrence_number: number
          root_cause: string | null
          source_id: string
          source_type: string
          state: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          closure_reason?: string | null
          created_at?: string
          created_by?: string | null
          deduplication_key: string
          description?: string | null
          due_at: string
          effectiveness_result?: string | null
          effectiveness_review_due_at?: string | null
          escalated_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          owner_profile_id?: string | null
          priority: string
          recurrence_key?: string | null
          recurrence_number?: number
          root_cause?: string | null
          source_id: string
          source_type: string
          state?: string
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          closure_reason?: string | null
          created_at?: string
          created_by?: string | null
          deduplication_key?: string
          description?: string | null
          due_at?: string
          effectiveness_result?: string | null
          effectiveness_review_due_at?: string | null
          escalated_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          owner_profile_id?: string | null
          priority?: string
          recurrence_key?: string | null
          recurrence_number?: number
          root_cause?: string | null
          source_id?: string
          source_type?: string
          state?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "work_item_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_backfill_exceptions: {
        Row: {
          created_at: string
          details: Json
          employee_id: string
          exception_code: string
          id: string
          organization_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          employee_id: string
          exception_code: string
          id?: string
          organization_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          employee_id?: string
          exception_code?: string
          id?: string
          organization_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_backfill_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_backfill_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_backfill_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_employee_links: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          organization_id: string
          person_id: string
          source: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          organization_id: string
          person_id: string
          source?: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          organization_id?: string
          person_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_employee_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_employee_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_employee_links_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "workforce_people"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_people: {
        Row: {
          created_at: string
          email: string | null
          external_ref: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          organization_id: string
          phone: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          external_ref?: string | null
          first_name: string
          id?: string
          is_active?: boolean
          last_name: string
          organization_id: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          external_ref?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          organization_id?: string
          phone?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xapi_statements: {
        Row: {
          authority: string
          context: Json
          employee_id: string
          id: string
          object_iri: string
          occurred_at: string
          organization_id: string
          result: Json
          runtime_session_id: string | null
          statement_id: string
          statement_sha256: string
          stored_at: string
          verb_iri: string
        }
        Insert: {
          authority: string
          context?: Json
          employee_id: string
          id?: string
          object_iri: string
          occurred_at: string
          organization_id: string
          result?: Json
          runtime_session_id?: string | null
          statement_id: string
          statement_sha256: string
          stored_at?: string
          verb_iri: string
        }
        Update: {
          authority?: string
          context?: Json
          employee_id?: string
          id?: string
          object_iri?: string
          occurred_at?: string
          organization_id?: string
          result?: Json
          runtime_session_id?: string | null
          statement_id?: string
          statement_sha256?: string
          stored_at?: string
          verb_iri?: string
        }
        Relationships: [
          {
            foreignKeyName: "xapi_statements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xapi_statements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xapi_statements_runtime_session_id_fkey"
            columns: ["runtime_session_id"]
            isOneToOne: false
            referencedRelation: "learning_runtime_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      exclusion_source_health: {
        Row: {
          activated_snapshot_id: string | null
          active_checksum: string | null
          active_record_count: number | null
          active_since: string | null
          active_snapshot_id: string | null
          completed_at: string | null
          expected_record_count: number | null
          health_status: string | null
          is_stale: boolean | null
          last_attempt_at: string | null
          last_error: string | null
          last_run_checksum: string | null
          last_run_id: string | null
          last_status: string | null
          last_success_at: string | null
          source: string | null
          staged_record_count: number | null
          started_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exclusion_source_state_active_snapshot_fkey"
            columns: ["active_snapshot_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_source_snapshots"
            referencedColumns: ["id", "source"]
          },
          {
            foreignKeyName: "exclusion_source_state_last_run_fkey"
            columns: ["last_run_id", "source"]
            isOneToOne: false
            referencedRelation: "exclusion_refresh_runs"
            referencedColumns: ["id", "source"]
          },
        ]
      }
    }
    Functions: {
      accept_integration_command: {
        Args: {
          p_command_type: string
          p_correlation_id: string
          p_credential_id: string
          p_idempotency_key: string
          p_payload: Json
          p_request_sha256: string
          p_schema_version: string
        }
        Returns: {
          command_id: string
          command_status: string
          correlation_id: string
          was_duplicate: boolean
        }[]
      }
      acknowledge_notification_spend_alert: {
        Args: { p_alert_id: string }
        Returns: undefined
      }
      activate_notification_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      activate_regulatory_rule_version: {
        Args: { p_version_id: string }
        Returns: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "regulatory_rule_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_emergency_update_course_block: {
        Args: {
          p_body?: Json
          p_course_block_id: string
          p_document_id?: string
          p_reason: string
          p_title?: string
          p_video_url?: string
        }
        Returns: undefined
      }
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
          email_opt_out: boolean
          email_opt_out_at: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          notification_timezone: string
          organization_id: string | null
          phone: string | null
          preferred_notification_channel: string
          role: string
          sms_consent_at: string | null
          sms_opt_in: boolean
          sms_opt_out_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_employee_lifecycle_transition: {
        Args: {
          p_effective_on?: string
          p_employee_id: string
          p_facility_id?: string
          p_reason?: string
          p_transition: string
        }
        Returns: string
      }
      apply_hris_import_batch: {
        Args: { p_batch_size?: number; p_import_run_id: string }
        Returns: Json
      }
      apply_scim_change: {
        Args: {
          p_connection_id: string
          p_external_subject_id: string
          p_operation: string
          p_payload: Json
          p_payload_sha256: string
          p_request_id: string
        }
        Returns: Json
      }
      approve_certification_attempt: {
        Args: {
          p_assessor_signature_sha256: string
          p_attempt_id: string
          p_decision: string
          p_reason: string
        }
        Returns: string
      }
      approve_regulatory_rule_version: {
        Args: { p_review_notes: string; p_version_id: string }
        Returns: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "regulatory_rule_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_training_session_completion: {
        Args: { p_class_id: string; p_reason: string }
        Returns: string
      }
      assert_course_version_publish_ready: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      assert_identity_assurance: {
        Args: { p_operation: string }
        Returns: undefined
      }
      assert_resident_assessment_compliance_item_valid: {
        Args: { p_compliance_item_id: string; p_resident_id: string }
        Returns: undefined
      }
      assign_organization_release_cohort: {
        Args: {
          p_cohort_id: string
          p_expires_at?: string
          p_feature_key: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      authenticate_integration_api_credential: {
        Args: {
          p_correlation_id?: string
          p_required_scope?: string
          p_secret_sha256: string
        }
        Returns: {
          credential_id: string
          expires_at: string
          organization_id: string
          rate_limit_per_minute: number
          scopes: string[]
        }[]
      }
      authorize_evidence_guest_artifact: {
        Args: {
          p_artifact_id: string
          p_event_type: string
          p_fingerprint?: string
          p_token: string
        }
        Returns: Json
      }
      begin_exclusion_source_refresh: {
        Args: { p_correlation_id: string; p_source: string }
        Returns: Json
      }
      begin_notification_delivery_attempt: {
        Args: {
          p_content_sha256: string
          p_delivery_id: string
          p_provider: string
        }
        Returns: {
          accepted_at: string | null
          attempt_number: number
          callback_token: string
          content_sha256: string | null
          delivery_id: string
          error_code: string | null
          error_detail: string | null
          estimated_cost_micros: number
          finalized_at: string | null
          id: string
          organization_id: string
          profile_id: string
          provider: string
          provider_message_id: string | null
          provider_status: string | null
          response_status: number | null
          started_at: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_delivery_attempts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      begin_system_job: {
        Args: {
          p_correlation_id: string
          p_job_key: string
          p_provider_request_id?: string
          p_trigger_type?: string
        }
        Returns: string
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
          lifecycle_disposition: string
          lifecycle_dispositioned_at: string | null
          lifecycle_event_id: string | null
          lifecycle_reason: string | null
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
          lifecycle_disposition: string
          lifecycle_dispositioned_at: string | null
          lifecycle_event_id: string | null
          lifecycle_reason: string | null
          training_record_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "training_class_attendees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_certificate_pdf_jobs: {
        Args: {
          p_certificate_id?: string
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          certificate_id: string
          correlation_id: string
          job_id: string
          run_id: string
        }[]
      }
      claim_integration_webhook_deliveries: {
        Args: {
          p_batch_size?: number
          p_delivery_id?: string
          p_endpoint_id?: string
          p_stale_after_seconds?: number
        }
        Returns: {
          attempt_number: number
          correlation_id: string
          delivery_id: string
          destination_url: string
          endpoint_id: string
          event_id: string
          event_schema_version: string
          max_attempts: number
          organization_id: string
          plaintext_signing_secret: string
          request_body: Json
          timeout_ms: number
        }[]
      }
      claim_open_shift: {
        Args: { p_opportunity_id: string }
        Returns: {
          claim_id: string
          claim_status: string
          eligibility_decision_id: string
          shift_assignment_id: string
        }[]
      }
      claim_pending_notification_deliveries: {
        Args: { p_batch_size: number; p_stale_after_seconds: number }
        Returns: {
          accepted_at: string | null
          attempt_count: number
          channel: string
          created_at: string
          delivered_at: string | null
          delivery_type: string
          error_code: string | null
          error_message: string | null
          escalation_reason: string | null
          fallback_group_id: string
          fallback_sequence: number
          final_outcome: string | null
          finalized_at: string | null
          id: string
          last_provider_status: string | null
          next_attempt_at: string
          notification_id: string | null
          organization_id: string
          parent_delivery_id: string | null
          profile_id: string
          provider: string | null
          provider_message_id: string | null
          quiet_hours_deferred_count: number
          recipient: string
          sent_at: string | null
          skip_reason: string | null
          status: string
          template_version_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_system_job_execution: {
        Args: {
          p_correlation_id: string
          p_job_key: string
          p_provider_request_id?: string
          p_trigger_type?: string
        }
        Returns: {
          existing_status: string
          run_id: string
          should_execute: boolean
        }[]
      }
      clear_auto_filled_assignments: {
        Args: { p_schedule_id: string }
        Returns: number
      }
      close_own_support_ticket: {
        Args: { p_ticket_id: string }
        Returns: undefined
      }
      commit_learning_runtime_state: {
        Args: {
          p_idempotency_key: string
          p_runtime_session_id: string
          p_sequence_number: number
          p_state: Json
        }
        Returns: string
      }
      complete_course_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
<<<<<<< HEAD
      complete_resident_compliance_item: {
        Args: { p_item_id: string }
=======
      complete_exclusion_source_refresh: {
        Args: { p_expected_record_count: number; p_run_id: string }
        Returns: Json
      }
      complete_integration_webhook_delivery: {
        Args: {
          p_attempt_number: number
          p_delivery_id: string
          p_duration_ms: number
          p_error_code: string
          p_error_message: string
          p_http_status: number
          p_request_timestamp: number
          p_response_sha256: string
          p_retryable: boolean
          p_success: boolean
        }
        Returns: string
      }
      complete_notification_delivery_attempt: {
        Args: {
          p_attempt_id: string
          p_error_code: string
          p_error_detail: string
          p_http_status: number
          p_provider_message_id: string
          p_provider_status: string
          p_result: string
        }
        Returns: undefined
      }
      complete_resident_compliance_item: {
        Args: { p_document_id: string; p_item_id: string }
>>>>>>> origin/main
        Returns: {
          citation_topic_id: string | null
          completed_date: string | null
          created_at: string
          due_date: string | null
          facility_id: string
          grace_period_days: number
          id: string
          item_type: string
          notes: string | null
          organization_id: string
          renewal_interval_days: number | null
          resident_id: string
          status: string
          triggered_by_item_id: string | null
          updated_at: string
          warning_days: number
        }
        SetofOptions: {
          from: "*"
          to: "resident_compliance_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_training_class: {
        Args: { p_class_id: string }
        Returns: undefined
      }
      consume_integration_rate_limit: {
        Args: { p_cost?: number; p_credential_id: string }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      course_version_is_published: {
        Args: { p_version_id: string }
        Returns: boolean
      }
      create_audit_legal_hold: {
        Args: {
          p_ends_at?: string
          p_facility_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      create_course_from_ai_draft: {
        Args: { p_draft: Json; p_generation_id: string }
        Returns: {
          course_id: string
          course_version_id: string
        }[]
      }
      create_credential_renewal_submission: {
        Args: {
          p_credential_document_id: string
          p_credential_id: string
          p_credential_type: string
          p_employee_id: string
        }
        Returns: string
      }
      create_deduplicated_work_item: {
        Args: {
          p_dedupe: string
          p_description: string
          p_due_at: string
          p_fac: string
          p_org: string
          p_owner: string
          p_priority: string
          p_source_id: string
          p_source_type: string
          p_template_key: string
          p_title: string
        }
        Returns: string
      }
      create_governed_content_revision: {
        Args: {
          p_asset_id: string
          p_change_summary: string
          p_material_change: boolean
          p_material_change_action: string
          p_snapshot: Json
          p_source_version_id: string
        }
        Returns: string
      }
      create_hris_import_run: {
        Args: {
          p_import_mode?: string
          p_request_id: string
          p_source_checksum_sha256?: string
          p_source_count?: number
          p_source_cursor?: string
          p_source_system_id: string
        }
        Returns: string
      }
      create_integration_webhook_endpoint: {
        Args: {
          p_description?: string
          p_destination_url: string
          p_event_types: string[]
          p_name: string
          p_organization_id: string
        }
        Returns: {
          endpoint_id: string
          plaintext_signing_secret: string
          secret_version: number
        }[]
      }
      create_notification_template_version: {
        Args: {
          p_activate?: boolean
          p_allowed_variables?: string[]
          p_body_template: string
          p_channel: string
          p_organization_id: string
          p_subject_template: string
          p_template_key: string
        }
        Returns: string
      }
      create_schedule_eligibility_override: {
        Args: {
          p_authority_reference: string
          p_block_code: string
          p_employee_id: string
          p_expires_at: string
          p_facility_id: string
          p_reason: string
          p_scope_id: string
          p_scope_type: string
        }
        Returns: string
      }
      create_scim_connection: {
        Args: {
          p_default_facility_id: string
          p_display_name: string
          p_organization_id: string
          p_provider: string
        }
        Returns: {
          connection_id: string
          connection_key: string
          credential_secret: string
        }[]
      }
      create_violation_retraining_action: {
        Args: {
          p_course_id: string
          p_course_version_id: string
          p_description: string
          p_due_date: string
          p_employee_id: string
          p_violation_id: string
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "corrective_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_org_id: { Args: never; Returns: string }
      current_profile_active: { Args: never; Returns: boolean }
      current_role: { Args: never; Returns: string }
      deactivate_integration_webhook_endpoint: {
        Args: { p_endpoint_id: string; p_reason: string }
        Returns: undefined
      }
      decide_shift_swap: {
        Args: {
          p_approve: boolean
          p_reason: string
          p_swap_request_id: string
        }
        Returns: boolean
      }
      employee_has_active_qualification: {
        Args: {
          p_at?: string
          p_employee_id: string
          p_qualification_key: string
        }
        Returns: boolean
      }
      end_enterprise_role_grant: {
        Args: { p_effective_to?: string; p_grant_id: string; p_reason?: string }
        Returns: undefined
      }
      enqueue_integration_test_delivery: {
        Args: { p_endpoint_id: string; p_payload?: Json }
        Returns: string
      }
      enqueue_preferred_notification_delivery: {
        Args: {
          p_delivery_type: string
          p_notification_id: string
          p_organization_id: string
          p_profile_id: string
        }
        Returns: string
      }
      ensure_employee_record: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      ensure_training_requirement_record: {
        Args: { p_employee_id: string; p_training_type_id: string }
        Returns: undefined
      }
      escalate_unactioned_alerts: { Args: never; Returns: undefined }
<<<<<<< HEAD
=======
      evaluate_feature_access: {
        Args: {
          p_as_of?: string
          p_feature_key: string
          p_organization_id: string
          p_required_quantity?: number
        }
        Returns: Json
      }
      evaluate_learning_path: {
        Args: {
          p_expected_state_version: number
          p_outcomes: Json
          p_path_assignment_id: string
        }
        Returns: Json
      }
      evaluate_schedule_eligibility: {
        Args: {
          p_employee_id: string
          p_ends_at: string
          p_exclude_assignment_ids?: string[]
          p_facility_id: string
          p_required_credential_types?: string[]
          p_required_qualification_keys?: string[]
          p_required_training_type_ids?: string[]
          p_starts_at: string
        }
        Returns: Json
      }
      exclusion_source_record_key: {
        Args: {
          p_business_name: string
          p_dob: string
          p_exclusion_date: string
          p_exclusion_type: string
          p_first_name: string
          p_last_name: string
          p_middle_name: string
          p_npi: string
          p_reinstate_date: string
          p_source: string
          p_upin: string
          p_waiver_date: string
        }
        Returns: string
      }
      execute_registered_sql_job: {
        Args: {
          p_correlation_id: string
          p_job_key: string
          p_trigger_type?: string
        }
        Returns: Json
      }
      explain_employee_compliance_profile: {
        Args: { p_employee_id: string; p_on?: string }
        Returns: Json
      }
      fail_exclusion_source_refresh: {
        Args: { p_error: string; p_run_id: string }
        Returns: Json
      }
>>>>>>> origin/main
      finalize_resident_assessment_form: {
        Args: { p_form_id: string }
        Returns: {
          cloned_from_id: string | null
          compliance_item_id: string | null
          content: Json
          created_at: string
          facility_id: string
          finalized_at: string | null
          form_type: string
          id: string
          organization_id: string
          prepared_by_name: string | null
          prepared_by_profile_id: string | null
          prepared_by_title: string | null
          prepared_date: string | null
          reason: string
          resident_id: string
          schema_version: number
          status: string
          superseded_by_id: string | null
          updated_at: string
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "resident_assessment_forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
<<<<<<< HEAD
=======
      finish_certificate_pdf_job: {
        Args: {
          p_bucket?: string
          p_error_code?: string
          p_error_message?: string
          p_job_id: string
          p_path?: string
          p_run_id: string
        }
        Returns: boolean
      }
      finish_system_job: {
        Args: {
          p_attempted_count?: number
          p_error_code?: string
          p_error_message?: string
          p_failed_count?: number
          p_result?: Json
          p_run_id: string
          p_status: string
          p_succeeded_count?: number
        }
        Returns: undefined
      }
>>>>>>> origin/main
      generate_class_checkin_token: {
        Args: { p_class_id: string; p_long_lived?: boolean }
        Returns: string
      }
      generate_schedule_assignments: {
        Args: { p_schedule_id: string }
        Returns: Json
      }
      get_audit_coverage: {
        Args: never
        Returns: {
          audit_mode: string
          contains_regulated_data: boolean
          has_required_trigger: boolean
          rationale: string
          table_name: string
        }[]
      }
      get_audit_export_manifest: {
        Args: { p_from: string; p_organization_id?: string; p_to: string }
        Returns: Json
      }
      get_audit_governance_status: { Args: never; Returns: Json }
      get_billing_reconciliation: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      get_closed_loop_compliance_control_plane: { Args: never; Returns: Json }
      get_course_version_publish_issues: {
        Args: { p_version_id: string }
        Returns: string[]
      }
      get_effective_access: {
        Args: { p_at?: string }
        Returns: {
          effective_from: string
          effective_to: string
          permission_key: string
          role_template_code: string
          scope_id: string
          scope_type: string
        }[]
      }
      get_effective_entitlements: {
        Args: { p_as_of?: string; p_organization_id?: string }
        Returns: {
          billing_state: string
          effective_from: string
          effective_to: string
          entitlement_source: string
          entitlement_value: Json
          feature_key: string
          is_entitled: boolean
          value_type: string
        }[]
      }
      get_enterprise_scope_control_plane: { Args: never; Returns: Json }
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
      get_governed_learning_control_plane: { Args: never; Returns: Json }
      get_identity_control_plane: {
        Args: never
        Returns: {
          active_scim_connection_count: number
          active_sso_connection_count: number
          open_break_glass_count: number
          organization_id: string
          privileged_profile_count: number
          privileged_profiles_without_mfa: number
          revocations_last_30_days: number
          verified_domain_count: number
        }[]
      }
      get_integration_control_plane: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      get_notification_delivery_evidence: {
        Args: { p_delivery_id: string }
        Returns: Json
      }
      get_notification_delivery_health: { Args: never; Returns: Json }
      get_notification_delivery_operations: {
        Args: { p_hours?: number; p_organization_id?: string }
        Returns: Json
      }
      get_notification_template_library: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      get_platform_health: { Args: never; Returns: Json }
      get_qualified_workforce_control_plane: { Args: never; Returns: Json }
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
      get_regulatory_rule_control_plane: {
        Args: never
        Returns: {
          activation_ready: boolean
          author_profile_id: string
          effective_from: string
          golden_fixture_count: number
          jurisdiction_code: string
          passing_fixture_count: number
          reviewer_profile_id: string
          rule_key: string
          rule_name: string
          rule_pack_id: string
          shadow_organization_count: number
          state: string
          unresolved_difference_count: number
          version_id: string
          version_number: number
        }[]
      }
      get_regulatory_rule_snapshot: {
        Args: { p_as_of: string; p_rule_key: string }
        Returns: {
          applicability: Json
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          effective_from: string
          effective_to: string
          jurisdiction_code: string
          rule_version_id: string
          source_checksum_sha256: string
          source_uri: string
          version_number: number
        }[]
      }
      get_scim_auth_material: {
        Args: { p_connection_key: string }
        Returns: {
          connection_id: string
          connection_status: string
          credential_hash_sha256: string
          credential_salt: string
          organization_id: string
        }[]
      }
      get_scim_connection_registry: {
        Args: never
        Returns: {
          connection_id: string
          connection_key: string
          created_at: string
          credential_hint: string
          default_facility_id: string
          display_name: string
          last_rotated_at: string
          organization_id: string
          provider: string
          status: string
        }[]
      }
      get_system_job_control_plane: {
        Args: never
        Returns: {
          attempted_count: number
          description: string
          display_name: string
          error_message: string
          execution_kind: string
          failed_count: number
          is_critical: boolean
          is_stale: boolean
          job_key: string
          last_attempt_at: string
          last_duration_ms: number
          last_status: string
          last_success_at: string
          next_expected_at: string
          operator_route: string
          retry_mode: string
          schedule: string
          succeeded_count: number
        }[]
      }
      get_system_job_recovery_state: {
        Args: never
        Returns: {
          cancellation_pending: boolean
          circuit_open_until: string
          circuit_state: string
          dead_letter_count: number
          failure_rate_24h: number
          job_key: string
          kill_switch_enabled: boolean
          kill_switch_reason: string
          last_known_good_at: string
          last_known_good_result: Json
          latest_dead_letter_run_id: string
          latest_run_id: string
          provider_latency_ms_24h: number
          queue_age_ms: number
          retry_cost_units_24h: number
        }[]
      }
      get_workforce_compliance_control_plane: { Args: never; Returns: Json }
      grade_quiz_attempt: { Args: { p_attempt_id: string }; Returns: undefined }
      grant_enterprise_role: {
        Args: {
          p_effective_from?: string
          p_effective_to?: string
          p_profile_id: string
          p_reason?: string
          p_role_template_id: string
          p_scope_id: string
          p_scope_type: string
        }
        Returns: string
      }
      grant_identity_break_glass: {
        Args: {
          p_expires_at: string
          p_reason: string
          p_requested_by: string
          p_target_profile_id: string
          p_ticket_reference: string
        }
        Returns: string
      }
      has_effective_entitlement: {
        Args: {
          p_as_of?: string
          p_feature_key: string
          p_organization_id: string
          p_required_quantity?: number
        }
        Returns: boolean
      }
      has_effective_permission: {
        Args: {
          p_at?: string
          p_permission_key: string
          p_scope_id: string
          p_scope_type: string
        }
        Returns: boolean
      }
      heartbeat_system_job: {
        Args: {
          p_attempted_count?: number
          p_cursor?: Json
          p_failed_count?: number
          p_run_id: string
          p_succeeded_count?: number
        }
        Returns: undefined
      }
      identity_assurance_is_current: {
        Args: { p_operation: string }
        Returns: boolean
      }
      identity_operation_requires_aal2: {
        Args: { p_operation: string }
        Returns: boolean
      }
      ingest_xapi_statement: {
        Args: {
          p_actor_employee_id: string
          p_context: Json
          p_object_iri: string
          p_occurred_at: string
          p_result: Json
          p_runtime_session_id: string
          p_statement_id: string
          p_verb_iri: string
        }
        Returns: string
      }
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
      is_employee_access_active: {
        Args: { p_at?: string; p_employee_id: string }
        Returns: boolean
      }
      is_employee_assigned_to_facility: {
        Args: { p_employee_id: string; p_facility_id: string }
        Returns: boolean
      }
      is_own_employee_assigned_to_facility: {
        Args: { p_facility_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_system_job_cancellation_requested: {
        Args: { p_run_id: string }
        Returns: boolean
      }
      issue_certificate: {
        Args: {
          p_course_assignment_id?: string
          p_course_id: string
          p_employee_id: string
          p_expires_at?: string
        }
        Returns: string
      }
      issue_evidence_guest_grant: {
        Args: {
          p_allowed_artifact_ids: string[]
          p_collection_id: string
          p_expires_at: string
          p_guest_email_hash: string
          p_guest_label: string
          p_step_up: boolean
        }
        Returns: Json
      }
      issue_integration_api_credential: {
        Args: {
          p_expires_at: string
          p_name: string
          p_organization_id: string
          p_rate_limit_per_minute?: number
          p_scopes: string[]
        }
        Returns: {
          credential_id: string
          expires_at: string
          key_prefix: string
          plaintext_key: string
        }[]
      }
      link_sso_identity_subject: {
        Args: {
          p_link_method?: string
          p_profile_id: string
          p_provider_subject: string
          p_sso_connection_id: string
        }
        Returns: string
      }
      list_integration_events: {
        Args: {
          p_after_sequence?: number
          p_credential_id: string
          p_limit?: number
        }
        Returns: {
          causation_id: string
          correlation_id: string
          event_id: string
          event_schema_version: string
          event_type: string
          occurred_at: string
          payload: Json
          sequence_number: number
        }[]
      }
      log_document_access: {
        Args: { p_document_id: string; p_document_table: string }
        Returns: undefined
      }
      log_resident_change_of_condition: {
<<<<<<< HEAD
        Args: { p_notes?: string | null; p_resident_id: string }
=======
        Args: { p_notes?: string; p_resident_id: string }
>>>>>>> origin/main
        Returns: {
          citation_topic_id: string | null
          completed_date: string | null
          created_at: string
          due_date: string | null
          facility_id: string
          grace_period_days: number
          id: string
          item_type: string
          notes: string | null
          organization_id: string
          renewal_interval_days: number | null
          resident_id: string
          status: string
          triggered_by_item_id: string | null
          updated_at: string
          warning_days: number
        }
        SetofOptions: {
          from: "*"
          to: "resident_compliance_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      match_exclusion_list_against_roster_core: {
        Args: { p_organization_id?: string; p_source: string }
        Returns: undefined
      }
      notification_next_permitted_at: {
        Args: { p_requested_at: string; p_timezone: string }
        Returns: string
      }
      notification_phone_key: { Args: { p_phone: string }; Returns: string }
      owns_employee: { Args: { p_employee_id: string }; Returns: boolean }
      plan_audit_archive: {
        Args: { p_from: string; p_organization_id?: string; p_to: string }
        Returns: string
      }
      preview_employee_lifecycle_transition: {
        Args: {
          p_effective_on?: string
          p_employee_id: string
          p_facility_id?: string
          p_reason?: string
          p_transition: string
        }
        Returns: Json
      }
      preview_notification_template: {
        Args: { p_template_id: string; p_variables?: Json }
        Returns: Json
      }
      preview_notification_template_draft: {
        Args: {
          p_allowed_variables: string[]
          p_body_template: string
          p_subject_template: string
          p_variables?: Json
        }
        Returns: Json
      }
      process_stripe_billing_event: {
        Args: {
          p_correlation_id: string
          p_event_created_at: string
          p_event_id: string
          p_event_type: string
          p_payload: Json
          p_payload_sha256: string
        }
        Returns: {
          canonical_state: string
          resolved_organization_id: string
          was_applied: boolean
          was_duplicate: boolean
          was_stale: boolean
        }[]
      }
      publish_course_version: {
        Args: { p_course_version_id: string }
        Returns: string
      }
      publish_governed_content_revision: {
        Args: { p_reason: string; p_revision_id: string }
        Returns: string
      }
      publish_schedule: { Args: { p_schedule_id: string }; Returns: undefined }
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
      reconcile_audit_integrity: { Args: { p_limit?: number }; Returns: Json }
      reconcile_billing_states: { Args: { p_as_of?: string }; Returns: number }
      reconcile_course_completion_certificates: {
        Args: { p_limit?: number; p_organization_id?: string }
        Returns: Json
      }
      reconcile_regulatory_shadow_difference: {
        Args: {
          p_difference_id: string
          p_evidence_checksum_sha256: string
          p_rationale: string
          p_resolution: string
        }
        Returns: string
      }
      record_credential_renewal_extraction: {
        Args: {
          p_confidence: Json
          p_extracted_fields: Json
          p_extraction_model: string
          p_extraction_provider: string
          p_scan_evidence: Json
          p_scan_provider: string
          p_scan_status: string
          p_submission_id: string
        }
        Returns: boolean
      }
      record_notification_consent_event: {
        Args: {
          p_action: string
          p_attempt_id?: string
          p_channel: string
          p_occurred_at: string
          p_provider: string
          p_provider_event_id: string
          p_recipient?: string
          p_recipient_fingerprint: string
          p_source: string
        }
        Returns: number
      }
      record_notification_consent_events: {
        Args: { p_events: Json }
        Returns: number
      }
      record_notification_provider_event: {
        Args: {
          p_attempt_id: string
          p_error_code: string
          p_error_detail: string
          p_event_type: string
          p_occurred_at: string
          p_outcome: string
          p_provider: string
          p_provider_event_id: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      record_notification_provider_events: {
        Args: { p_events: Json }
        Returns: number
      }
      record_regulatory_fixture_result: {
        Args: {
          p_actual_result: Json
          p_engine_version: string
          p_failure_detail?: string
          p_fixture_id: string
          p_request_id: string
        }
        Returns: string
      }
      record_regulatory_shadow_run: {
        Args: {
          p_baseline_version_id: string
          p_cohort_ended_at: string
          p_cohort_started_at: string
          p_differences?: Json
          p_engine_version: string
          p_evaluated_count: number
          p_facility_type: string
          p_organization_id: string
          p_request_id: string
          p_rule_version_id: string
        }
        Returns: string
      }
      record_report_snapshot: {
        Args: {
          p_as_of: string
          p_facility_id: string
          p_material_totals: Json
          p_reconciliation_detail: Json
          p_reconciliation_status: string
          p_record_ids: Json
          p_report_version_id: string
          p_row_counts: Json
          p_source_watermarks: Json
        }
        Returns: string
      }
      record_training_attendance: {
        Args: {
          p_attendance_status: string
          p_attendee_signature_sha256: string
          p_check_in_at: string
          p_check_out_at: string
          p_evidence: Json
          p_recorder_signature_sha256: string
          p_registration_id: string
        }
        Returns: string
      }
      register_for_training_session: {
        Args: { p_class_id: string; p_employee_id: string }
        Returns: {
          registration_id: string
          registration_status: string
          waitlist_position: number
        }[]
      }
      register_identity_domain: {
        Args: {
          p_domain: string
          p_organization_id: string
          p_verification_challenge_sha256: string
        }
        Returns: string
      }
      release_audit_legal_hold: {
        Args: { p_hold_id: string; p_reason: string }
        Returns: undefined
      }
      render_notification_template_text: {
        Args: {
          p_allowed_variables: string[]
          p_template: string
          p_variables: Json
        }
        Returns: string
      }
      reopen_own_support_ticket: {
        Args: { p_ticket_id: string }
        Returns: undefined
      }
      replace_quiz_questions: {
        Args: { p_questions: Json; p_quiz_id: string }
        Returns: undefined
      }
      replay_integration_webhook_delivery: {
        Args: { p_delivery_id: string; p_reason: string }
        Returns: string
      }
      replay_system_job_dead_letter: {
        Args: { p_reason: string; p_run_id: string }
        Returns: {
          correlation_id: string
          run_id: string
        }[]
      }
      request_shift_swap: {
        Args: {
          p_reason: string
          p_requester_assignment_id: string
          p_target_assignment_id: string
        }
        Returns: string
      }
      request_system_job_cancellation: {
        Args: { p_reason: string; p_run_id: string }
        Returns: undefined
      }
      request_system_job_rerun: {
        Args: { p_job_key: string; p_reason: string }
        Returns: {
          correlation_id: string
          run_id: string
        }[]
      }
      require_identity_administrator: {
        Args: { p_operation?: string; p_organization_id: string }
        Returns: undefined
      }
      require_platform_rule_admin: {
        Args: { p_operation: string }
        Returns: undefined
      }
      rescan_org_exclusion_matches: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      resume_confidential_incident_intake: {
        Args: {
          p_intake_number: string
          p_narrative: string
          p_public_summary: string
          p_resume_secret: string
        }
        Returns: boolean
      }
      retry_notification_delivery: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      review_credential_renewal_submission: {
        Args: {
          p_confirmed_fields: Json
          p_decision: string
          p_reason: string
          p_submission_id: string
        }
        Returns: string
      }
      review_governed_content_revision: {
        Args: { p_decision: string; p_reason: string; p_revision_id: string }
        Returns: boolean
      }
      revoke_identity_break_glass: {
        Args: { p_event_id: string; p_reason: string }
        Returns: boolean
      }
      revoke_identity_domain: {
        Args: { p_domain_id: string; p_reason: string }
        Returns: boolean
      }
      revoke_identity_sessions: {
        Args: {
          p_deactivate_profile?: boolean
          p_external_request_id?: string
          p_profile_id: string
          p_reason: string
          p_source: string
        }
        Returns: string
      }
      revoke_integration_api_credential: {
        Args: { p_credential_id: string; p_reason: string }
        Returns: undefined
      }
      rotate_integration_api_credential: {
        Args: { p_credential_id: string; p_expires_at?: string }
        Returns: {
          credential_id: string
          expires_at: string
          key_prefix: string
          plaintext_key: string
        }[]
      }
      rotate_integration_webhook_secret: {
        Args: { p_endpoint_id: string }
        Returns: {
          endpoint_id: string
          plaintext_signing_secret: string
          secret_version: number
        }[]
      }
      rotate_scim_connection_credential: {
        Args: { p_connection_id: string }
        Returns: {
          connection_key: string
          credential_secret: string
        }[]
      }
      run_phase1_synthetic_checks: { Args: never; Returns: Json }
      self_enroll_course: { Args: { p_course_id: string }; Returns: string }
      send_monday_digest: { Args: never; Returns: undefined }
      send_policy_attestation_reminders: { Args: never; Returns: undefined }
      set_billing_account_override: {
        Args: {
          p_expires_at?: string
          p_organization_id: string
          p_override_state: string
          p_reason: string
        }
        Returns: undefined
      }
      set_certificate_pdf: {
        Args: { p_bucket: string; p_certificate_id: string; p_path: string }
        Returns: {
          course_assignment_id: string | null
          course_id: string
          created_at: string
          credential_number: string
          employee_id: string
          expires_at: string | null
          facility_id: string
          id: string
          issued_at: string
          organization_id: string
          pdf_attempt_count: number
          pdf_last_attempt_at: string | null
          pdf_last_error: string | null
          pdf_ready_at: string | null
          pdf_status: string
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
      set_employee_qualification_state: {
        Args: { p_qualification_id: string; p_reason: string; p_state: string }
        Returns: boolean
      }
      set_feature_kill_switch: {
        Args: {
          p_expires_at?: string
          p_feature_key: string
          p_is_disabled?: boolean
          p_organization_id?: string
          p_reason?: string
        }
        Returns: string
      }
      set_hris_import_row_decision: {
        Args: {
          p_decision: string
          p_employee_id: string
          p_import_row_id: string
          p_reason: string
        }
        Returns: boolean
      }
      set_notification_channel_policy: {
        Args: {
          p_fallback_delay_minutes: number
          p_fallback_enabled: boolean
          p_max_fallback_depth: number
          p_organization_id: string
        }
        Returns: undefined
      }
      set_notification_spend_policy: {
        Args: {
          p_email_estimate_usd: number
          p_monthly_budget_usd: number
          p_organization_id: string
          p_sms_estimate_usd: number
          p_warning_percent?: number
        }
        Returns: undefined
      }
      set_organization_entitlement_grant: {
        Args: {
          p_approved_by?: string
          p_contract_reference?: string
          p_decision: string
          p_effective_from?: string
          p_effective_to?: string
          p_entitlement_value: Json
          p_feature_key: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      set_package_entitlement: {
        Args: {
          p_contract_reference?: string
          p_effective_from?: string
          p_effective_to?: string
          p_entitlement_value: Json
          p_feature_key: string
          p_package_id: string
          p_reason: string
        }
        Returns: string
      }
      set_release_flag: {
        Args: {
          p_expires_at?: string
          p_feature_key: string
          p_is_enabled: boolean
          p_owner: string
          p_reason: string
          p_rollout_mode: string
        }
        Returns: undefined
      }
      set_system_job_kill_switch: {
        Args: { p_enabled: boolean; p_job_key: string; p_reason: string }
        Returns: undefined
      }
      stage_hris_import_row: {
        Args: {
          p_external_employment_id: string
          p_external_person_id: string
          p_import_run_id: string
          p_normalized_payload: Json
          p_row_number: number
          p_source_payload_sha256: string
        }
        Returns: string
      }
      start_confidential_incident_intake: {
        Args: {
          p_confirmation_token: string
          p_encrypted_contact: Json
          p_facility_id: string
          p_immediate_danger: boolean
          p_narrative: string
          p_occurred_at: string
          p_public_summary: string
          p_report_type: string
          p_reporter_mode: string
          p_resident_id: string
          p_resume_secret: string
          p_severity: string
        }
        Returns: Json
      }
      start_course_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
<<<<<<< HEAD
      start_resident_assessment_form: {
        Args: { p_compliance_item_id?: string | null; p_reason: string; p_resident_id: string }
=======
      start_regulatory_rule_shadow: {
        Args: { p_version_id: string }
        Returns: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "regulatory_rule_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_resident_assessment_form: {
        Args: {
          p_compliance_item_id?: string
          p_reason: string
          p_resident_id: string
        }
>>>>>>> origin/main
        Returns: {
          cloned_from_id: string | null
          compliance_item_id: string | null
          content: Json
          created_at: string
          facility_id: string
          finalized_at: string | null
          form_type: string
          id: string
          organization_id: string
          prepared_by_name: string | null
          prepared_by_profile_id: string | null
          prepared_by_title: string | null
          prepared_date: string | null
          reason: string
          resident_id: string
          schema_version: number
          status: string
          superseded_by_id: string | null
          updated_at: string
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "resident_assessment_forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
<<<<<<< HEAD
=======
      submit_governed_content_revision: {
        Args: { p_revision_id: string; p_validation_results: Json }
        Returns: boolean
      }
      submit_regulatory_rule_version: {
        Args: { p_version_id: string }
        Returns: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "regulatory_rule_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_offline_learning_action: {
        Args: {
          p_action_type: string
          p_assignment_id: string
          p_client_base_version: number
          p_client_occurred_at: string
          p_client_sequence: number
          p_device_id: string
          p_idempotency_key: string
          p_payload: Json
        }
        Returns: Json
      }
      transition_work_item: {
        Args: {
          p_reason: string
          p_target_state: string
          p_work_item_id: string
        }
        Returns: boolean
      }
      unpublish_schedule: {
        Args: { p_schedule_id: string }
        Returns: undefined
      }
      update_profile_contact_preferences: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_phone: string
          p_preferred_notification_channel: string
          p_profile_id: string
          p_sms_opt_in: boolean
        }
        Returns: {
          created_at: string
          email: string
          email_opt_out: boolean
          email_opt_out_at: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          notification_timezone: string
          organization_id: string | null
          phone: string | null
          preferred_notification_channel: string
          role: string
          sms_consent_at: string | null
          sms_opt_in: boolean
          sms_opt_out_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_compliance_profile_assignment: {
        Args: {
          p_effective_from?: string
          p_effective_to?: string
          p_employee_id: string
          p_profile_definition_id: string
          p_reason?: string
        }
        Returns: string
      }
      upsert_enterprise_role_template: {
        Args: {
          p_code: string
          p_description: string
          p_name: string
          p_organization_id: string
          p_permission_keys: string[]
          p_role_template_id?: string
        }
        Returns: string
      }
      validate_hris_import_run: {
        Args: { p_import_run_id: string }
        Returns: Json
      }
>>>>>>> origin/main
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
      verify_identity_domain: {
        Args: { p_domain_id: string; p_observed_challenge_sha256: string }
        Returns: boolean
      }
      withdraw_regulatory_rule_version: {
        Args: { p_reason: string; p_version_id: string }
        Returns: {
          activated_at: string | null
          applicability: Json
          approved_at: string | null
          authored_by: string
          authority_name: string
          calculation_parameters: Json
          citation: string
          content_checksum_sha256: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_code: string
          release_notes: string
          review_notes: string | null
          reviewed_by: string | null
          rule_pack_id: string
          shadow_started_at: string | null
          source_checksum_sha256: string
          source_uri: string | null
          state: string
          submitted_at: string | null
          submitted_by: string | null
          superseded_at: string | null
          supersedes_version_id: string | null
          updated_at: string
          version_number: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "regulatory_rule_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_course_block_heygen_state: {
        Args: { p_block_id: string; p_body: Json; p_video_url?: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

