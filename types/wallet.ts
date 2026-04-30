export type TransacaoTipo = 'credito' | 'debito' | 'saque' | 'desconto'

export interface Carteira {
  id: string
  indicadorId: string
  saldoDisponivel: number
  saldoPendente: number
  saldoEmDesconto: number
  totalRecebido: number
  updatedAt: Date
}

export interface Transacao {
  id: string
  carteiraId: string
  indicadorId: string
  tipo: TransacaoTipo
  valor: number
  saldoAnterior: number
  saldoPosterior: number
  descricao: string
  referencia?: string // ID da indicação ou pagamento
  createdAt: Date
}

export interface ExtratoFilters {
  tipo?: TransacaoTipo | 'todos'
  dataInicio?: Date
  dataFim?: Date
}

export interface CarteiraResumo {
  saldoDisponivel: number
  saldoPendente: number
  saldoEmDesconto: number
  totalRecebido: number
  ultimaTransacao?: Date
}
