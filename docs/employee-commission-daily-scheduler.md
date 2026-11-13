# Reconciliação diária de comissão — DESLIGADA

Sprint 3.1F-J6. O reconciliador existe e é retomável, mas **não há agendamento**.

- Nenhuma Vercel Cron nova.
- Nenhum `pg_cron`, worker pago ou serviço adicional.
- Execução atual: botão administrativo **Reconciliar comissões** (Admin Master / Admin Financeiro).
- `DAILY_SCHEDULER=DISABLED`.

## Como ligar no servidor próprio (quando existir)

1. Confirmar que as modalidades de comissão passaram no GATE 1 (ordem da primeira fatura e/ou pagamento integral, conforme o método).
2. No servidor da empresa, criar uma consulta diária (cron do SO, systemd timer ou equivalente **já existente** — não contratar serviço novo).
3. Autenticar como administrador financeiro da sessão interna e chamar a RPC `admin_reconcile_employee_commissions` **uma vez** por ciclo, com `limit` baixo (ex.: 50) e a mesma `idempotencyKey` só para retomar o mesmo ciclo.
4. Não configurar `/api/cron/*` na Vercel para esta rotina.
5. Se a RPC devolver `reconcile_in_progress`, não disparar outra: esperar o ciclo atual terminar ou retomar o mesmo `runId`.
6. Falha do ERP (quando existir no futuro) não deve alterar oportunidade nem competência; nesta entrega o reconciliador **não chama ERP**.
