export type IndicadorFaqItem = {
  id: string
  question: string
  answer: string
}

export const INDICADOR_FAQ_ITEMS: IndicadorFaqItem[] = [
  {
    id: "tanto-livre",
    question: "O que é Tanto Livre?",
    answer:
      "Tanto Livre é a modalidade de contratação sem permanência mínima. O cliente tem mais liberdade, mas pode não ter os mesmos benefícios comerciais do Tanto Vantagens.",
  },
  {
    id: "tanto-vantagens",
    question: "O que é Tanto Vantagens?",
    answer:
      "Tanto Vantagens é a modalidade com período de permanência e benefícios comerciais, como condições promocionais, descontos ou vantagens específicas conforme campanha vigente.",
  },
  {
    id: "diferenca-contratacao",
    question: "Qual a diferença entre Tanto Livre e Tanto Vantagens?",
    answer:
      "No Tanto Livre, o cliente tem mais flexibilidade. No Tanto Vantagens, o cliente pode ter acesso a condições melhores, mas precisa respeitar as regras e o período de permanência da contratação.",
  },
  {
    id: "taxas-instalacao",
    question: "Pode haver taxa de instalação ou habilitação?",
    answer:
      "Sim. Dependendo da campanha, endereço, equipamento, plano ou análise comercial, podem existir taxas de instalação, habilitação, equipamentos ou outros custos. O comercial confirma as condições antes da contratação.",
  },
  {
    id: "liberacao-recompensa",
    question: "Quando minha recompensa é liberada?",
    answer:
      "A recompensa é liberada após a confirmação do pagamento da primeira mensalidade do cliente indicado, conforme as regras do programa.",
  },
  {
    id: "acompanhar-indicacao",
    question: "Como acompanho minha indicação?",
    answer:
      "Você pode acompanhar o andamento da indicação pelo painel do indicador, na área Minhas Indicações.",
  },
  {
    id: "solicitar-saque",
    question: "Como solicito saque?",
    answer:
      "Após ter saldo disponível suficiente, acesse Carteira e solicite o saque via Pix.",
  },
  {
    id: "valor-minimo-saque",
    question: "Qual o valor mínimo para saque?",
    answer: "O valor mínimo para solicitação de saque é R$ 100,00.",
  },
  {
    id: "prazo-saque",
    question: "Quando recebo meu saque?",
    answer:
      "Os pagamentos seguem o calendário definido pela empresa e dependem da aprovação do financeiro.",
  },
  {
    id: "indicacao-recusada",
    question: "O que acontece se a indicação for recusada?",
    answer:
      "Se a indicação for recusada, o motivo ficará disponível no acompanhamento da indicação. Indicações recusadas não geram recompensa.",
  },
  {
    id: "quantas-indicacoes",
    question: "Posso indicar quantas pessoas?",
    answer:
      "Sim. Você pode indicar quantas pessoas quiser, desde que as indicações sejam reais e sigam as regras do programa.",
  },
  {
    id: "precisa-contratar",
    question: "O indicado precisa contratar para eu ganhar?",
    answer:
      "Sim. A recompensa depende da contratação e da confirmação do pagamento da primeira mensalidade.",
  },
]
