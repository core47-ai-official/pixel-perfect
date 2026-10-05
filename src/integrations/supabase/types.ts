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
      admissions: {
        Row: {
          admitted_at: string
          admitting_doctor_id: string
          bed_id: string | null
          bed_request_id: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          deposit_amount: number
          discharge_note: string | null
          discharge_type: string | null
          discharged_at: string | null
          hospital_id: string
          id: string
          patient_id: string
          reason: string
          status: string
          transfers: Json
          updated_at: string
        }
        Insert: {
          admitted_at?: string
          admitting_doctor_id: string
          bed_id?: string | null
          bed_request_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          deposit_amount?: number
          discharge_note?: string | null
          discharge_type?: string | null
          discharged_at?: string | null
          hospital_id: string
          id?: string
          patient_id: string
          reason: string
          status?: string
          transfers?: Json
          updated_at?: string
        }
        Update: {
          admitted_at?: string
          admitting_doctor_id?: string
          bed_id?: string | null
          bed_request_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          deposit_amount?: number
          discharge_note?: string | null
          discharge_type?: string | null
          discharged_at?: string | null
          hospital_id?: string
          id?: string
          patient_id?: string
          reason?: string
          status?: string
          transfers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admissions_admitting_doctor_id_fkey"
            columns: ["admitting_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          called_at: string | null
          cancel_reason: string | null
          channel: string
          checked_in_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          doctor_id: string
          fee: number
          follow_up_of: string | null
          hospital_id: string
          id: string
          patient_id: string
          slot_end: string
          slot_start: string
          status: string
          token_no: number | null
          type: string
          updated_at: string
        }
        Insert: {
          called_at?: string | null
          cancel_reason?: string | null
          channel?: string
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          doctor_id: string
          fee?: number
          follow_up_of?: string | null
          hospital_id: string
          id?: string
          patient_id: string
          slot_end: string
          slot_start: string
          status?: string
          token_no?: number | null
          type?: string
          updated_at?: string
        }
        Update: {
          called_at?: string | null
          cancel_reason?: string | null
          channel?: string
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          doctor_id?: string
          fee?: number
          follow_up_of?: string | null
          hospital_id?: string
          id?: string
          patient_id?: string
          slot_end?: string
          slot_start?: string
          status?: string
          token_no?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_follow_up_of_fkey"
            columns: ["follow_up_of"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          details: Json
          hospital_id: string
          id: string
          invoice_id: string
          patient_id: string
          payment_id: string | null
          percent: number | null
          reason: string
          requested_by: string
          requested_by_name: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: Json
          hospital_id: string
          id?: string
          invoice_id: string
          patient_id: string
          payment_id?: string | null
          percent?: number | null
          reason: string
          requested_by: string
          requested_by_name?: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: Json
          hospital_id?: string
          id?: string
          invoice_id?: string
          patient_id?: string
          payment_id?: string | null
          percent?: number | null
          reason?: string
          requested_by?: string
          requested_by_name?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          hospital_id: string
          id: string
          impersonated_by: string | null
          ip: string | null
          resource: string
          resource_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          hospital_id: string
          id?: string
          impersonated_by?: string | null
          ip?: string | null
          resource: string
          resource_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          hospital_id?: string
          id?: string
          impersonated_by?: string | null
          ip?: string | null
          resource?: string
          resource_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      bed_requests: {
        Row: {
          admission_id: string | null
          allotted_at: string | null
          allotted_by: string | null
          bed_class: string
          bed_id: string | null
          created_at: string
          created_by: string | null
          doctor_id: string | null
          hospital_id: string
          id: string
          note: string
          patient_id: string
          priority: string
          requested_by: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          admission_id?: string | null
          allotted_at?: string | null
          allotted_by?: string | null
          bed_class?: string
          bed_id?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id: string
          id?: string
          note?: string
          patient_id: string
          priority?: string
          requested_by: string
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admission_id?: string | null
          allotted_at?: string | null
          allotted_by?: string | null
          bed_class?: string
          bed_id?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          note?: string
          patient_id?: string
          priority?: string
          requested_by?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bed_requests_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: false
            referencedRelation: "admissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bed_requests_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bed_requests_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bed_requests_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bed_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      beds: {
        Row: {
          bed_class: string
          created_at: string
          created_by: string | null
          current_admission_id: string | null
          daily_rate: number
          has_oxygen: boolean
          has_ventilator: boolean
          hospital_id: string
          id: string
          label: string
          status: string
          updated_at: string
          ward_id: string
        }
        Insert: {
          bed_class?: string
          created_at?: string
          created_by?: string | null
          current_admission_id?: string | null
          daily_rate?: number
          has_oxygen?: boolean
          has_ventilator?: boolean
          hospital_id: string
          id?: string
          label: string
          status?: string
          updated_at?: string
          ward_id: string
        }
        Update: {
          bed_class?: string
          created_at?: string
          created_by?: string | null
          current_admission_id?: string | null
          daily_rate?: number
          has_oxygen?: boolean
          has_ventilator?: boolean
          hospital_id?: string
          id?: string
          label?: string
          status?: string
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds_current_admission_fk"
            columns: ["current_admission_id"]
            isOneToOne: false
            referencedRelation: "admissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      cashier_shifts: {
        Row: {
          cashier_id: string
          cashier_name: string
          closed_at: string | null
          counted_cash: number | null
          created_at: string
          created_by: string | null
          difference: number | null
          expected_cash: number | null
          hospital_id: string
          id: string
          note: string | null
          opened_at: string
          opening_cash: number
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          cashier_id: string
          cashier_name?: string
          closed_at?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          difference?: number | null
          expected_cash?: number | null
          hospital_id: string
          id?: string
          note?: string | null
          opened_at?: string
          opening_cash?: number
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          cashier_id?: string
          cashier_name?: string
          closed_at?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          difference?: number | null
          expected_cash?: number | null
          hospital_id?: string
          id?: string
          note?: string | null
          opened_at?: string
          opening_cash?: number
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shifts_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          is_primary: boolean
          label: string
          type: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          is_primary?: boolean
          label?: string
          type: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          is_primary?: boolean
          label?: string
          type?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_contacts_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          appointments: Json
          billing: Json
          branding: Json
          created_at: string
          created_by: string | null
          dashboards: Json
          emergency: Json
          general: Json
          hospital_id: string
          id: string
          lab: Json
          localization: Json
          notifications: Json
          opd: Json
          patient_portal: Json
          pharmacy: Json
          printing: Json
          security: Json
          updated_at: string
          wards: Json
        }
        Insert: {
          appointments?: Json
          billing?: Json
          branding?: Json
          created_at?: string
          created_by?: string | null
          dashboards?: Json
          emergency?: Json
          general?: Json
          hospital_id: string
          id?: string
          lab?: Json
          localization?: Json
          notifications?: Json
          opd?: Json
          patient_portal?: Json
          pharmacy?: Json
          printing?: Json
          security?: Json
          updated_at?: string
          wards?: Json
        }
        Update: {
          appointments?: Json
          billing?: Json
          branding?: Json
          created_at?: string
          created_by?: string | null
          dashboards?: Json
          emergency?: Json
          general?: Json
          hospital_id?: string
          id?: string
          lab?: Json
          localization?: Json
          notifications?: Json
          opd?: Json
          patient_portal?: Json
          pharmacy?: Json
          printing?: Json
          security?: Json
          updated_at?: string
          wards?: Json
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: true
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      counters: {
        Row: {
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          key: string
          next_value: number
          prefix: string
          reset_rule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          key: string
          next_value?: number
          prefix?: string
          reset_rule?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          key?: string
          next_value?: number
          prefix?: string
          reset_rule?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "counters_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_layouts: {
        Row: {
          created_at: string
          created_by: string | null
          dashboard: string
          hospital_id: string
          id: string
          updated_at: string
          user_id: string
          widgets: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dashboard?: string
          hospital_id: string
          id?: string
          updated_at?: string
          user_id: string
          widgets?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dashboard?: string
          hospital_id?: string
          id?: string
          updated_at?: string
          user_id?: string
          widgets?: Json
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_layouts_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          head_doctor_id: string | null
          hospital_id: string
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          head_doctor_id?: string | null
          hospital_id: string
          id?: string
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          head_doctor_id?: string | null
          hospital_id?: string
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          admission_id: string | null
          amount: number
          applied_amount: number
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          note: string
          patient_id: string
          payment_mode: string
          receipt_no: string
          received_by: string
          shift_id: string | null
          updated_at: string
        }
        Insert: {
          admission_id?: string | null
          amount: number
          applied_amount?: number
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          note?: string
          patient_id: string
          payment_mode?: string
          receipt_no: string
          received_by: string
          shift_id?: string | null
          updated_at?: string
        }
        Update: {
          admission_id?: string | null
          amount?: number
          applied_amount?: number
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          note?: string
          patient_id?: string
          payment_mode?: string
          receipt_no?: string
          received_by?: string
          shift_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: false
            referencedRelation: "admissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_shift_fk"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cashier_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_leaves: {
        Row: {
          affected_appointments: number
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          doctor_id: string
          from_date: string
          hospital_id: string
          id: string
          reason: string
          status: Database["public"]["Enums"]["leave_status"]
          to_date: string
          type: string
          updated_at: string
        }
        Insert: {
          affected_appointments?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          doctor_id: string
          from_date: string
          hospital_id: string
          id?: string
          reason?: string
          status?: Database["public"]["Enums"]["leave_status"]
          to_date: string
          type?: string
          updated_at?: string
        }
        Update: {
          affected_appointments?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          doctor_id?: string
          from_date?: string
          hospital_id?: string
          id?: string
          reason?: string
          status?: Database["public"]["Enums"]["leave_status"]
          to_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_leaves_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_leaves_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          doctor_id: string
          end_time: string
          hospital_id: string
          id: string
          max_patients: number | null
          room: string | null
          slot_minutes: number
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doctor_id: string
          end_time: string
          hospital_id: string
          id?: string
          max_patients?: number | null
          room?: string | null
          slot_minutes?: number
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          end_time?: string
          hospital_id?: string
          id?: string
          max_patients?: number | null
          room?: string | null
          slot_minutes?: number
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_schedules_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_schedules_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          consultation_fee: number
          created_at: string
          created_by: string | null
          department_id: string | null
          followup_fee: number
          gender: string | null
          hospital_id: string
          id: string
          languages: string[]
          pmdc_no: string | null
          specialty: string
          status: Database["public"]["Enums"]["doctor_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          consultation_fee?: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          followup_fee?: number
          gender?: string | null
          hospital_id: string
          id?: string
          languages?: string[]
          pmdc_no?: string | null
          specialty?: string
          status?: Database["public"]["Enums"]["doctor_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          consultation_fee?: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          followup_fee?: number
          gender?: string | null
          hospital_id?: string
          id?: string
          languages?: string[]
          pmdc_no?: string | null
          specialty?: string
          status?: Database["public"]["Enums"]["doctor_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      drug_interactions: {
        Row: {
          created_at: string
          created_by: string | null
          group_a: string
          group_b: string
          hospital_id: string
          id: string
          note: string
          severity: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_a: string
          group_b: string
          hospital_id: string
          id?: string
          note?: string
          severity?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_a?: string
          group_b?: string
          hospital_id?: string
          id?: string
          note?: string
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drug_interactions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_cases: {
        Row: {
          arrival_mode: string
          arrived_at: string
          bay_bed_id: string | null
          bed_request_id: string | null
          complaint: string
          created_at: string
          created_by: string | null
          disposition: string | null
          disposition_at: string | null
          disposition_note: string | null
          hospital_id: string
          id: string
          mlc: boolean
          mlc_details: Json
          patient_id: string
          seen_at: string | null
          seen_by: string | null
          seen_by_name: string | null
          triage_color: string | null
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
        }
        Insert: {
          arrival_mode?: string
          arrived_at?: string
          bay_bed_id?: string | null
          bed_request_id?: string | null
          complaint?: string
          created_at?: string
          created_by?: string | null
          disposition?: string | null
          disposition_at?: string | null
          disposition_note?: string | null
          hospital_id: string
          id?: string
          mlc?: boolean
          mlc_details?: Json
          patient_id: string
          seen_at?: string | null
          seen_by?: string | null
          seen_by_name?: string | null
          triage_color?: string | null
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
        }
        Update: {
          arrival_mode?: string
          arrived_at?: string
          bay_bed_id?: string | null
          bed_request_id?: string | null
          complaint?: string
          created_at?: string
          created_by?: string | null
          disposition?: string | null
          disposition_at?: string | null
          disposition_note?: string | null
          hospital_id?: string
          id?: string
          mlc?: boolean
          mlc_details?: Json
          patient_id?: string
          seen_at?: string | null
          seen_by?: string | null
          seen_by_name?: string | null
          triage_color?: string | null
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_cases_bay_bed_id_fkey"
            columns: ["bay_bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_cases_bed_request_id_fkey"
            columns: ["bed_request_id"]
            isOneToOne: false
            referencedRelation: "bed_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_cases_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_cases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          created_at: string
          function_name: string | null
          hospital_id: string | null
          id: string
          message: string
          page: string | null
          stack: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          function_name?: string | null
          hospital_id?: string | null
          id?: string
          message: string
          page?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          function_name?: string | null
          hospital_id?: string | null
          id?: string
          message?: string
          page?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_notes: {
        Row: {
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          note: string
          shift: string
          shift_date: string
          updated_at: string
          ward_id: string
          written_by: string
          written_by_name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          note: string
          shift: string
          shift_date: string
          updated_at?: string
          ward_id: string
          written_by: string
          written_by_name?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          note?: string
          shift?: string
          shift_date?: string
          updated_at?: string
          ward_id?: string
          written_by?: string
          written_by_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "handover_notes_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_notes_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          hospital_id: string
          id: string
          is_recurring: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          hospital_id: string
          id?: string
          is_recurring?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          hospital_id?: string
          id?: string
          is_recurring?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      icd10_codes: {
        Row: {
          chapter: string | null
          code: string
          created_at: string
          description: string
          updated_at: string
        }
        Insert: {
          chapter?: string | null
          code: string
          created_at?: string
          description: string
          updated_at?: string
        }
        Update: {
          chapter?: string | null
          code?: string
          created_at?: string
          description?: string
          updated_at?: string
        }
        Relationships: []
      }
      impersonation_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          expires_at: string
          hospital_id: string
          id: string
          pages_visited: Json
          reason: string
          started_at: string
          super_admin_id: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          expires_at: string
          hospital_id: string
          id?: string
          pages_visited?: Json
          reason: string
          started_at?: string
          super_admin_id: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          expires_at?: string
          hospital_id?: string
          id?: string
          pages_visited?: Json
          reason?: string
          started_at?: string
          super_admin_id?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          approval_id: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          invoice_id: string
          last_reminded_on: string | null
          paid_at_start: number
          patient_id: string
          schedule: Json
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          invoice_id: string
          last_reminded_on?: string | null
          paid_at_start?: number
          patient_id: string
          schedule?: Json
          status?: string
          total: number
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          invoice_id?: string
          last_reminded_on?: string | null
          paid_at_start?: number
          patient_id?: string
          schedule?: Json
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          hospital_id: string
          id: string
          invoice_id: string
          posted_by: string | null
          qty: number
          rate: number
          source_id: string | null
          source_type: string
          tariff_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description: string
          hospital_id: string
          id?: string
          invoice_id: string
          posted_by?: string | null
          qty?: number
          rate?: number
          source_id?: string | null
          source_type?: string
          tariff_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string
          hospital_id?: string
          id?: string
          invoice_id?: string
          posted_by?: string | null
          qty?: number
          rate?: number
          source_id?: string | null
          source_type?: string
          tariff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          admission_id: string | null
          balance: number
          created_at: string
          created_by: string | null
          discount: number
          hospital_id: string
          id: string
          invoice_no: string
          paid: number
          patient_id: string
          payer_type: string
          status: string
          total: number
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          admission_id?: string | null
          balance?: number
          created_at?: string
          created_by?: string | null
          discount?: number
          hospital_id: string
          id?: string
          invoice_no: string
          paid?: number
          patient_id: string
          payer_type?: string
          status?: string
          total?: number
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          admission_id?: string | null
          balance?: number
          created_at?: string
          created_by?: string | null
          discount?: number
          hospital_id?: string
          id?: string
          invoice_no?: string
          paid?: number
          patient_id?: string
          payer_type?: string
          status?: string
          total?: number
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: false
            referencedRelation: "admissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_tests: {
        Row: {
          category: string
          code: string
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          is_active: boolean
          name: string
          price: number
          reference_range: string | null
          sample_type: string | null
          turnaround_hours: number
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          reference_range?: string | null
          sample_type?: string | null
          turnaround_hours?: number
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          reference_range?: string | null
          sample_type?: string | null
          turnaround_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_tests_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          brand_name: string | null
          created_at: string
          created_by: string | null
          drap_reg_no: string | null
          form: string
          generic_name: string
          hospital_id: string
          id: string
          interaction_group: string[]
          is_active: boolean
          route: string
          strength: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          brand_name?: string | null
          created_at?: string
          created_by?: string | null
          drap_reg_no?: string | null
          form?: string
          generic_name: string
          hospital_id: string
          id?: string
          interaction_group?: string[]
          is_active?: boolean
          route?: string
          strength?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          brand_name?: string | null
          created_at?: string
          created_by?: string | null
          drap_reg_no?: string | null
          form?: string
          generic_name?: string
          hospital_id?: string
          id?: string
          interaction_group?: string[]
          is_active?: boolean
          route?: string
          strength?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicines_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          created_by: string | null
          delivery_status: string
          hospital_id: string
          id: string
          link: string | null
          read_at: string | null
          scheduled_at: string
          sent_at: string | null
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          delivery_status?: string
          hospital_id: string
          id?: string
          link?: string | null
          read_at?: string | null
          scheduled_at?: string
          sent_at?: string | null
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          delivery_status?: string
          hospital_id?: string
          id?: string
          link?: string | null
          read_at?: string | null
          scheduled_at?: string
          sent_at?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_items: {
        Row: {
          created_at: string
          error: Json | null
          hospital_id: string
          id: string
          kind: string
          result: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: Json | null
          hospital_id: string
          id: string
          kind: string
          result?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: Json | null
          hospital_id?: string
          id?: string
          kind?: string
          result?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          doctor_id: string | null
          hospital_id: string
          id: string
          notes: string
          patient_id: string
          price: number
          priority: string
          result: string | null
          result_flag: string | null
          resulted_at: string | null
          status: string
          test_id: string
          updated_at: string
          verified_at: string | null
          visit_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id: string
          id?: string
          notes?: string
          patient_id: string
          price?: number
          priority?: string
          result?: string | null
          result_flag?: string | null
          resulted_at?: string | null
          status?: string
          test_id: string
          updated_at?: string
          verified_at?: string | null
          visit_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          notes?: string
          patient_id?: string
          price?: number
          priority?: string
          result?: string | null
          result_flag?: string | null
          resulted_at?: string | null
          status?: string
          test_id?: string
          updated_at?: string
          verified_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "lab_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          hospital_id: string
          id: string
          is_active: boolean
          name: string
          price: number
          tariff_codes: string[]
          updated_at: string
          valid_days: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          hospital_id: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          tariff_codes?: string[]
          updated_at?: string
          valid_days?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          hospital_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          tariff_codes?: string[]
          updated_at?: string
          valid_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "packages_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          allergies: string[]
          b_form: string | null
          blood_group: string | null
          chronic_conditions: string[]
          cnic: string | null
          created_at: string
          created_by: string | null
          district: string | null
          dob: string | null
          email: string | null
          father_or_husband_name: string | null
          full_name: string
          gender: string | null
          guardian_name: string | null
          guardian_phone: string | null
          hospital_id: string
          id: string
          is_unknown: boolean
          merged_into: string | null
          mrn: string
          phone: string | null
          pregnancy_status: string | null
          print_language: string | null
          province: string | null
          tehsil: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          allergies?: string[]
          b_form?: string | null
          blood_group?: string | null
          chronic_conditions?: string[]
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          dob?: string | null
          email?: string | null
          father_or_husband_name?: string | null
          full_name: string
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          hospital_id: string
          id?: string
          is_unknown?: boolean
          merged_into?: string | null
          mrn: string
          phone?: string | null
          pregnancy_status?: string | null
          print_language?: string | null
          province?: string | null
          tehsil?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          allergies?: string[]
          b_form?: string | null
          blood_group?: string | null
          chronic_conditions?: string[]
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          dob?: string | null
          email?: string | null
          father_or_husband_name?: string | null
          full_name?: string
          gender?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          hospital_id?: string
          id?: string
          is_unknown?: boolean
          merged_into?: string | null
          mrn?: string
          phone?: string | null
          pregnancy_status?: string | null
          print_language?: string | null
          province?: string | null
          tehsil?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deposit_id: string | null
          hospital_id: string
          id: string
          invoice_id: string
          kind: string
          patient_id: string
          payment_mode: string
          reason: string | null
          receipt_no: string
          received_by: string
          reversal_reason: string | null
          reversal_requested_at: string | null
          reversal_requested_by: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          shift_id: string | null
          tendered: number | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deposit_id?: string | null
          hospital_id: string
          id?: string
          invoice_id: string
          kind?: string
          patient_id: string
          payment_mode?: string
          reason?: string | null
          receipt_no: string
          received_by: string
          reversal_reason?: string | null
          reversal_requested_at?: string | null
          reversal_requested_by?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          tendered?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deposit_id?: string | null
          hospital_id?: string
          id?: string
          invoice_id?: string
          kind?: string
          patient_id?: string
          payment_mode?: string
          reason?: string | null
          receipt_no?: string
          received_by?: string
          reversal_reason?: string | null
          reversal_requested_at?: string | null
          reversal_requested_by?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          tendered?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_deposit_fk"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shift_fk"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cashier_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          created_at: string
          created_by: string | null
          dose: string
          duration_days: number | null
          frequency: string
          hospital_id: string
          id: string
          instructions_en: string
          instructions_ur: string
          medicine_id: string
          medicine_name: string
          prescription_id: string
          quantity: number
          route: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dose?: string
          duration_days?: number | null
          frequency?: string
          hospital_id: string
          id?: string
          instructions_en?: string
          instructions_ur?: string
          medicine_id: string
          medicine_name: string
          prescription_id: string
          quantity?: number
          route?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dose?: string
          duration_days?: number | null
          frequency?: string
          hospital_id?: string
          id?: string
          instructions_en?: string
          instructions_ur?: string
          medicine_id?: string
          medicine_name?: string
          prescription_id?: string
          quantity?: number
          route?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          created_by: string | null
          doctor_id: string
          hospital_id: string
          id: string
          notes: string
          patient_id: string
          status: string
          updated_at: string
          visit_id: string
          warnings: Json
          warnings_acknowledged: boolean
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id: string
          hospital_id: string
          id?: string
          notes?: string
          patient_id: string
          status?: string
          updated_at?: string
          visit_id: string
          warnings?: Json
          warnings_acknowledged?: boolean
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          hospital_id?: string
          id?: string
          notes?: string
          patient_id?: string
          status?: string
          updated_at?: string
          visit_id?: string
          warnings?: Json
          warnings_acknowledged?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          copies: number
          created_at: string
          created_by: string | null
          document_id: string | null
          document_type: string
          hospital_id: string
          id: string
          impersonated_by: string | null
          languages: string[]
          page: string | null
          paper: string
          patient_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          copies?: number
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          document_type: string
          hospital_id: string
          id?: string
          impersonated_by?: string | null
          languages?: string[]
          page?: string | null
          paper: string
          patient_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          copies?: number
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          document_type?: string
          hospital_id?: string
          id?: string
          impersonated_by?: string | null
          languages?: string[]
          page?: string | null
          paper?: string
          patient_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          hospital_id: string
          id: string
          is_active: boolean
          must_change_password: boolean
          phone: string | null
          photo_url: string | null
          preferences: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          hospital_id: string
          id: string
          is_active?: boolean
          must_change_password?: boolean
          phone?: string | null
          photo_url?: string | null
          preferences?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          hospital_id?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          phone?: string | null
          photo_url?: string | null
          preferences?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          created_by: string | null
          device: string | null
          endpoint: string
          hospital_id: string
          id: string
          keys: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device?: string | null
          endpoint: string
          hospital_id: string
          id?: string
          keys: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device?: string | null
          endpoint?: string
          hospital_id?: string
          id?: string
          keys?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string
          hospital_id: string
          id: string
          page: string | null
          raised_by: string
          screenshot_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          hospital_id: string
          id?: string
          page?: string | null
          raised_by: string
          screenshot_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          hospital_id?: string
          id?: string
          page?: string | null
          raised_by?: string
          screenshot_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      tariffs: {
        Row: {
          category: string
          code: string
          created_at: string
          created_by: string | null
          department_id: string | null
          hospital_id: string
          id: string
          is_active: boolean
          name: string
          price: number
          room_class: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          hospital_id: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          room_class?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          hospital_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          room_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      unpaid_followups: {
        Row: {
          by_name: string
          by_user: string
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          invoice_id: string
          note: string
          updated_at: string
        }
        Insert: {
          by_name?: string
          by_user: string
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          invoice_id: string
          note: string
          updated_at?: string
        }
        Update: {
          by_name?: string
          by_user?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          invoice_id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unpaid_followups_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unpaid_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          hospital_id: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
          ward_ids: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          hospital_id: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          ward_ids?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          hospital_id?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          ward_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_addenda: {
        Row: {
          author_id: string
          author_name: string
          body: string
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          updated_at: string
          visit_id: string
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          updated_at?: string
          visit_id: string
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_addenda_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_addenda_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_diagnoses: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          hospital_id: string
          icd10_code: string
          id: string
          is_primary: boolean
          updated_at: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          hospital_id: string
          icd10_code: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          visit_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          hospital_id?: string
          icd10_code?: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_diagnoses_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_diagnoses_icd10_code_fkey"
            columns: ["icd10_code"]
            isOneToOne: false
            referencedRelation: "icd10_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "visit_diagnoses_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          appointment_id: string | null
          chief_complaint: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          doctor_id: string
          examination: string
          history: string
          hospital_id: string
          id: string
          patient_id: string
          plan: string
          status: string
          template: string | null
          type: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          chief_complaint?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id: string
          examination?: string
          history?: string
          hospital_id: string
          id?: string
          patient_id: string
          plan?: string
          status?: string
          template?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          chief_complaint?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          examination?: string
          history?: string
          hospital_id?: string
          id?: string
          patient_id?: string
          plan?: string
          status?: string
          template?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      vitals: {
        Row: {
          bp_dia: number | null
          bp_sys: number | null
          created_at: string
          created_by: string | null
          height_cm: number | null
          hospital_id: string
          id: string
          patient_id: string
          pulse: number | null
          recorded_at: string
          recorded_by: string
          rr: number | null
          spo2: number | null
          temp_c: number | null
          updated_at: string
          visit_id: string | null
          weight_kg: number | null
        }
        Insert: {
          bp_dia?: number | null
          bp_sys?: number | null
          created_at?: string
          created_by?: string | null
          height_cm?: number | null
          hospital_id: string
          id?: string
          patient_id: string
          pulse?: number | null
          recorded_at?: string
          recorded_by: string
          rr?: number | null
          spo2?: number | null
          temp_c?: number | null
          updated_at?: string
          visit_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          bp_dia?: number | null
          bp_sys?: number | null
          created_at?: string
          created_by?: string | null
          height_cm?: number | null
          hospital_id?: string
          id?: string
          patient_id?: string
          pulse?: number | null
          recorded_at?: string
          recorded_by?: string
          rr?: number | null
          spo2?: number | null
          temp_c?: number | null
          updated_at?: string
          visit_id?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vitals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      wards: {
        Row: {
          created_at: string
          created_by: string | null
          floor: string | null
          gender: string
          hospital_id: string
          id: string
          is_active: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          floor?: string | null
          gender?: string
          hospital_id: string
          id?: string
          is_active?: boolean
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          floor?: string | null
          gender?: string
          hospital_id?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wards_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "dept_head"
        | "doctor"
        | "nurse"
        | "er_officer"
        | "ot_coordinator"
        | "receptionist"
        | "pharmacist"
        | "lab_tech"
        | "cashier"
        | "patient"
      doctor_status:
        | "available"
        | "in_opd"
        | "in_surgery"
        | "on_round"
        | "on_leave"
        | "off_duty"
      leave_status: "pending" | "approved" | "rejected"
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
      app_role: [
        "super_admin",
        "admin",
        "dept_head",
        "doctor",
        "nurse",
        "er_officer",
        "ot_coordinator",
        "receptionist",
        "pharmacist",
        "lab_tech",
        "cashier",
        "patient",
      ],
      doctor_status: [
        "available",
        "in_opd",
        "in_surgery",
        "on_round",
        "on_leave",
        "off_duty",
      ],
      leave_status: ["pending", "approved", "rejected"],
    },
  },
} as const
