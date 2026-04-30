import type { User } from './user'

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'

export type ComercialDisponibilidade = 'disponivel' | 'em_pausa' | 'offline'

export interface Indicador extends User {
  role: 'indicador'
  cpf: string
  chavePix?: string
  tipoChavePix?: TipoChavePix
  totalIndicacoes: number
  indicacoesAprovadas: number
  totalRecebido: number
  saldoDisponivel: number
  saldoDesconto: number
}

export interface Comercial extends User {
  role: 'comercial'
  disponibilidade: ComercialDisponibilidade
  leadsAtivos: number
  vendasRealizadas: number
  tempoMedioPrimeiroContato: number // em minutos
  metaMensal?: number
}

export interface Admin extends User {
  role: 'admin_consulta' | 'admin_financeiro' | 'admin_master'
  departamento?: string
}

export interface ProfileUpdateData {
  nome?: string
  telefone?: string
  avatar?: string
  chavePix?: string
  tipoChavePix?: TipoChavePix
}
