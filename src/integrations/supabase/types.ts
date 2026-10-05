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
