export interface Plano {
  id: string
  nome: string
  velocidade: string
  preco: number
  descricao: string
  valorRecompensa: number
  ativo: boolean
  ordem: number
  createdAt: Date
  updatedAt: Date
}

export interface PlanoCreateData {
  nome: string
  velocidade: string
  preco: number
  descricao: string
  valorRecompensa: number
  ativo?: boolean
  ordem?: number
}

export interface PlanoUpdateData extends Partial<PlanoCreateData> {
  id: string
}
