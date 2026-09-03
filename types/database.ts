// Tipos versionados mínimos alinhados ao schema/patches usados pelo app.
// Não regenerar automaticamente sem necessidade.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          nome: string
          email: string
          telefone: string
          role: string
          avatar: string | null
          ativo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nome: string
          email: string
          telefone: string
          role: string
          avatar?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nome?: string
          email?: string
          telefone?: string
          role?: string
          avatar?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          avatar_url: string | null
          cpf: string | null
          cnpj: string | null
          is_active: boolean
          must_change_password: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          phone: string
          role?: Database["public"]["Enums"]["user_role"]
          avatar_url?: string | null
          cpf?: string | null
          cnpj?: string | null
          is_active?: boolean
          must_change_password?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          avatar_url?: string | null
          cpf?: string | null
          cnpj?: string | null
          is_active?: boolean
          must_change_password?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      assisted_indicator_creations: {
        Row: {
          id: string
          idempotency_key: string
          actor_profile_id: string | null
          indicator_profile_id: string | null
          status: "pending" | "created" | "failed"
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          idempotency_key: string
          actor_profile_id?: string | null
          indicator_profile_id?: string | null
          status?: "pending" | "created" | "failed"
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          idempotency_key?: string
          actor_profile_id?: string | null
          indicator_profile_id?: string | null
          status?: "pending" | "created" | "failed"
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role:
        | "indicador"
        | "comercial"
        | "admin_consulta"
        | "admin_financeiro"
        | "admin_master"
      indicacao_status:
        | "pendente"
        | "em_atendimento"
        | "em_negociacao"
        | "aprovada"
        | "recusada"
        | "paga"
      lead_status:
        | "novo"
        | "em_atendimento"
        | "sem_contato"
        | "em_negociacao"
        | "vendido"
        | "perdido"
        | "redistribuido"
      pagamento_status: "pendente" | "aprovado" | "pago" | "cancelado"
    }
  }
}
