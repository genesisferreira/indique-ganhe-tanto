# 11 — Permissões: Admin Master × Admin Financeiro × Gestor × Funcionário (seção K)

**Definições:**
- **Gestor**: funcionário (`role = funcionario`) apontado em `employees.manager_employee_id` de outros funcionários. **Não é papel de login.**
- **`admin_consulta`**: hoje acessa `/admin/*`. Para remuneração, é tratado como "Gestor" (sem financeiro).

Nada desta matriz é implementado nesta sprint.

| Ação | Admin Master | Admin Financeiro | Gestor (e admin_consulta) | Funcionário |
|---|---:|---:|---:|---:|
| Visualizar salário/benefícios de qualquer funcionário | ✅ | ✅ | ❌ | ❌ |
| Visualizar vendas da equipe (sem valores) | ✅ | ✅ | ✅ só a própria equipe | ❌ |
| Criar draft de regra | ✅ | ✅ | ❌ | ❌ |
| Editar draft de regra (nova versão) | ✅ | ✅ | ❌ | ❌ |
| Aprovar/ativar regra | 🔒 futuro J10, ✅ (≠ criador) | 🔒 futuro J10, ✅ (≠ criador) | ❌ | ❌ |
| Configurar remuneração (draft de perfil) | ✅ | ✅ | ❌ | ❌ |
| Aprovar perfil de remuneração | 🔒 futuro, ✅ (≠ criador) | 🔒 futuro, ✅ (≠ criador) | ❌ | ❌ |
| Registrar dias trabalhados | ✅ | ✅ | ❌ (sugestão futura: Gestor propõe, Admin confirma) | ❌ |
| Calcular competência | 🔒 ✅ | 🔒 ✅ | ❌ | ❌ |
| Revisar competência | 🔒 ✅ | 🔒 ✅ | ❌ | ❌ |
| Fechar competência | 🔒 ✅ (fallback) | 🔒 ✅ (preferencial) | ❌ | ❌ |
| Registrar pagamento | 🔒 ✅ (fallback) | 🔒 ✅ (preferencial) | ❌ | ❌ |
| Ajustar (linha manual com motivo) | ✅ | ✅ | ❌ | ❌ |
| Estornar | 🔒 ✅ | 🔒 ✅ | ❌ | ❌ |
| Reabrir competência (nova versão) | 🔒 ✅ | ❌ (solicita ao Master) | ❌ | ❌ |
| Ver auditoria financeira | ✅ | ✅ | ❌ | ❌ |
| Ver dados próprios (vendas, comissões, componentes visíveis) | n/a | n/a | ✅ (os próprios) | ✅ (os próprios) |
| Criar oportunidade de funcionário | ❌ (RPC exige `funcionario`) | ❌ | ✅ se tiver membership elegível | ✅ se tiver membership elegível |
| Atribuir funcionário a oportunidade | ✅ (`attribute_employee_sales_opportunity`) | ✅ | ❌ | ❌ |

Legenda: ✅ permitido · ❌ negado · 🔒 desenhado, desabilitado até gate futuro.

## Segregação de funções — recomendação

| Pergunta | Recomendação |
|---|---|
| Quem cria pode aprovar? | **Não**: aprovação de regra e de perfil exige `approved_by ≠ created_by` (CHECK/RPC futuro) |
| Quem calcula pode fechar? | **Pode, mas não é recomendado**. O controle forte é **revisar ≠ fechar** |
| Quem fecha pode registrar pagamento? | **Não**: `paid_by ≠ closed_by` |

**Fallback para equipe mínima (2 admins: 1 Master + 1 Financeiro):**
- Financeiro cria a regra ou perfil → Master aprova (ou o inverso).
- Um calcula e revisa → o outro fecha.
- Quem não fechou registra o pagamento.

**Se só um admin estiver disponível** (férias): a ação é permitida com
"override de segregação". Ela exige um motivo ≥ 20 caracteres, gera o evento
`segregation_override` em `finance_audit_events` e alerta o outro admin
no centro de notificações. Nunca é silenciosa.

## Visibilidade de dados (resumo)

- O funcionário vê **apenas os próprios** registros e só os componentes com `show_* = true`.
- O Gestor vê etapa e status das vendas da equipe; **nunca** salário, vale, comissão ou total.
- Nenhum funcionário vê a remuneração de outro, nem os valores de outros papéis na mesma venda.
- Admin Master e Admin Financeiro veem tudo da remuneração; `admin_consulta` não vê nada financeiro.
