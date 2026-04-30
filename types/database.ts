// Placeholder for Supabase generated types
// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
// to generate actual types from your Supabase schema

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
      // Add more tables as needed
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: 'indicador' | 'comercial' | 'admin_consulta' | 'admin_financeiro' | 'admin_master'
      indicacao_status: 'pendente' | 'em_atendimento' | 'em_negociacao' | 'aprovada' | 'recusada' | 'paga'
      lead_status: 'novo' | 'em_atendimento' | 'sem_contato' | 'em_negociacao' | 'vendido' | 'perdido' | 'redistribuido'
      pagamento_status: 'pendente' | 'aprovado' | 'pago' | 'cancelado'
    }
  }
}
