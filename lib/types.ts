export type UserRole = 'indicador' | 'comercial' | 'admin_consulta' | 'admin_financeiro' | 'admin_master'

export type LeadStatus = 'novo' | 'em_atendimento' | 'sem_contato' | 'em_negociacao' | 'vendido' | 'perdido' | 'redistribuido'

export type IndicacaoStatus = 'pendente' | 'em_andamento' | 'aprovada' | 'recusada' | 'paga'

export type RecompensaTipo = 'pix' | 'desconto_fatura'

export type ComercialDisponibilidade = 'disponivel' | 'em_pausa' | 'offline'

export type PagamentoStatus = 'pendente' | 'aprovado' | 'pago'

export interface User {
  id: string
  nome: string
  email: string
  telefone: string
  role: UserRole
  avatar?: string
  createdAt: Date
}

export interface Indicador extends User {
  role: 'indicador'
  chavePix: string
  tipoChavePix: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'
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
  tempoMedioPrimeiroContato: number
}

export interface Admin extends User {
  role: 'admin_consulta' | 'admin_financeiro' | 'admin_master'
}

export interface Plano {
  id: string
  nome: string
  velocidade: string
  preco: number
  descricao: string
  ativo: boolean
}

export interface Indicacao {
  id: string
  indicadorId: string
  indicador: Indicador
  nomeIndicado: string
  telefoneIndicado: string
  emailIndicado?: string
  planoId: string
  plano: Plano
  tipoRecompensa: RecompensaTipo
  valorRecompensa: number
  status: IndicacaoStatus
  comercialId?: string
  comercial?: Comercial
  createdAt: Date
  updatedAt: Date
  primeiraFaturaPaga?: boolean
  dataAprovacao?: Date
}

export interface Lead {
  id: string
  indicacaoId: string
  indicacao: Indicacao
  comercialId: string
  comercial: Comercial
  status: LeadStatus
  primeiroContato?: Date
  ultimoContato?: Date
  retornoAgendado?: Date
  observacoes: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Pagamento {
  id: string
  indicadorId: string
  indicador: Indicador
  indicacaoId: string
  indicacao: Indicacao
  valor: number
  tipo: RecompensaTipo
  status: PagamentoStatus
  dataVencimento: Date
  dataPagamento?: Date
  comprovanteUrl?: string
  createdAt: Date
}

export interface Historico {
  id: string
  leadId: string
  comercialId: string
  comercial: Comercial
  acao: string
  descricao: string
  createdAt: Date
}

export interface DashboardIndicador {
  totalIndicacoes: number
  emAndamento: number
  aprovadas: number
  recusadas: number
  totalRecebido: number
  totalAReceber: number
  saldoDisponivel: number
  saldoEmDesconto: number
}

export interface DashboardComercial {
  leadsNovos: number
  leadsEmAtendimento: number
  leadsSemContato: number
  leadsEmNegociacao: number
  vendasRealizadas: number
  leadsPerdidos: number
  tempoMedioPrimeiroContato: string
}

export interface DashboardAdmin {
  totalIndicacoes: number
  novasIndicacoes: number
  leadsSemContato: number
  leadsRedistribuidos: number
  indicacoesAprovadas: number
  recompensasPendentes: number
  totalPago: number
  totalAPagar: number
  conversaoPorIndicacao: number
  rankingIndicadores: Array<{ indicador: Indicador; indicacoes: number; aprovadas: number }>
  rankingComerciais: Array<{ comercial: Comercial; vendas: number; tempoMedio: string }>
}
