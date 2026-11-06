# Employee commission & payroll ledger — foundation (3.1F-I1)

Status: **INACTIVE FOUNDATION**. Model, constraints, RLS, grants and internal RPCs only.
No rule is active, nothing is retroactive, nothing is calculated automatically, and nothing has a real financial effect.
This sprint has no forms, dashboards, cron jobs, webhooks, ERP evaluation or payments.

- Migration: `supabase/patch-employee-commission-payroll-ledger-foundation-3-1f-i1.sql`. It is additive, transactional and safe to re-apply, and it has not been applied remotely.
- Preflight/backfill report (read-only): `supabase/preflight-employee-commission-payroll-ledger-3-1f-i1.sql`. Expected backfill is **0**.
- Tests: `npm run test:i1-ledger-foundation` (static) and `npm run test:i1-ledger-pg` (local PostgreSQL lab on 127.0.0.1 only).

## Conventions
- Money is `numeric(10,2)` in BRL with explicit `round(x, 2)`. Floats are never used.
- Instants are `timestamptz` in UTC. Competence months are computed in `America/Sao_Paulo` (`payroll_competence_month_for`). Worked days are `date`.
- A competence starts on the first day of the month and ends on the last day (`payroll_competence_period_end`), covering February in normal and leap years and the December to January rollover.
- Every financial FK uses `ON DELETE RESTRICT`, or `SET NULL` for actor/profile columns. There is no cascade.

## Entities

| Entity | Purpose | Key uniqueness |
|---|---|---|
| `sales_opportunity_attributions` (existing, extended) | Employee ↔ employee-origin opportunity, by role | `UNIQUE (opportunity_id, attribution_role)` (kept); `idempotency_key` partial unique |
| `employee_commission_rules` | Versioned commission rules (draft only) | `(rule_family_id, version)`, `idempotency_key` |
| `employee_commission_entitlements` | Future commission rights (creation blocked) | `(opportunity_id, employee_id, attribution_role, trigger_kind, rule_id)` where not a reversal; `idempotency_key` |
| `employee_compensation_profiles` | Versioned salary/benefit configuration (draft only) | `(employee_id, version)`, `idempotency_key` |
| `employee_worked_days` | Worked or absent days per employee | `(employee_id, work_date)` |
| `payroll_competences` | Monthly competence per employee | `(employee_id, competence_month)` where `is_current`; `(employee_id, competence_month, version)` |
| `payroll_competence_lines` | Competence lines (append-only) | `idempotency_key` |
| `finance_audit_events` | Append-only financial audit | `idempotency_key` (partial) |

### Attribution roles (mapping)
| Business role | Stored `attribution_role` | Compatible sector code |
|---|---|---|
| technician | `technician_originator` | `technician` |
| external sales | `external_sales_originator` | `external_sales` |
| commercial / internal responsible | `internal_sales_responsible` (existing proven name; no alias) | `commercial` |

One opportunity can have up to three attributions, each held by a different employee. Each role has at most one employee, so the same employee cannot hold the same role twice and two technicians cannot share an opportunity.

## Commission rules
- Methods and triggers:
  - `fixed_amount` and `percentage` use `first_valid_invoice_generated`.
  - `first_invoice_value` uses `first_valid_invoice_fully_paid`.
  - Any other combination is rejected by a CHECK.
- `fixed_amount` must be greater than 0, with no rate and no base.
- `percentage` must have `0 < rate <= 1.00`. The 1.00 (100%) bound is a **technical completeness limit**, not a business cap. Rates are stored as fractions, so 0.02 means 2%.
- `first_invoice_value` accepts neither a fixed amount nor a rate.
- **`percentage_base` remains UNPROVEN.** It is nullable free text while a rule is a draft, and there is no enum of assumed ERP fields. Activating a percentage rule would also require `percentage_base` (CHECK `activation_ready`).
- Statuses: `draft | active | inactive | superseded`.
  - **Foundation gate:** `active = false AND status <> 'active'` and `retroactive = false` are enforced by CHECKs, so no rule can be active this sprint.
  - A later authorized sprint can remove the gate CHECKs.
- Versioning: `version_commission_rule_draft` inserts a new row (version + 1). The previous version only moves `draft → superseded`, and its values, method, trigger and scope are immutable by trigger, even for the table owner. Rules cannot be deleted.
- Future defaults are documentation only and are **not seeded**: technician R$ 30.00 fixed, external sales R$ 50.00 fixed, internal responsible 2%, all with active=false and retroactive=false.

## Entitlements
- Statuses: `pending_evidence | accrued | approved | included_in_payroll | paid | reversed | rejected`.
- **Creation is blocked this sprint.** A BEFORE INSERT trigger raises `financial_rules_inactive`, and no RPC inserts entitlements.
- Commission applies only when `referrals.origin_kind = 'employee'`.
- After `accrued`, these fields are immutable: `employee_id`, `amount`, `rule_snapshot`, `source`, `rule_id` and `opportunity_id`. Rows cannot be deleted.
- `paid` requires approval plus `paid_at`/`paid_by`, and can only come from `included_in_payroll`. Future automation may at most create `accrued`.
- `evidence_snapshot` is sanitized:
  - Allowed keys: `evidence_kind, trigger_kind, evidence_at, proof_version, source, checks`.
  - PII, tokens, raw payloads and ERP identifiers are forbidden.
- `triggering_contract_pk` and `triggering_invoice_pk` are opaque digit strings, never used as temporal order.

## Compensation profiles
- Optional components: salary, daily meal, transport and fuel (`per_worked_day | monthly_fixed`).
  - A NULL value means the component is not configured, and it never appears to the employee.
  - A visibility flag requires the component to be enabled.
  - The R$ 22.00/day meal value is a UI suggestion only, not a DB default.
- `employee_compensation_visible_components` always returns commission, plus each component that is both enabled and shown. With no salary configured, the employee sees commission only.
- Statuses: `draft | active | inactive`. `active` is forbidden this sprint. Every change creates a new version, and snapshots are immutable.

## Worked days
- Statuses: `worked | absent | vacation | leave | holiday | compensated`. `meal_eligible` is only allowed when the status is `worked`.
- The daily benefit preview (`payroll_daily_benefit_preview`) is the daily amount × eligible days. It is pure and is never persisted.
- Writes are idempotent per employee, date and operation. A different operation on the same day updates the row and is audited before and after.
- Once a competence is `closed` or `paid`, any change is rejected with `competence_closed_requires_adjustment`. Corrections must use an adjustment.

## Payroll competences and lines
- Statuses: `draft | calculated | reviewed | closed | paid | reopened`.
  - **`closed` and `paid` are blocked by CHECK this sprint.** No close or pay RPC exists.
  - In the future, closing and paying are reserved to Admin Master and Admin Financeiro.
- `open_payroll_competence_draft` normalizes the month and is idempotent per employee and month. It does not calculate, pay or create lines.
- Line types: `base_salary, commission, meal, transport, fuel, other_earning, discount, adjustment, reversal`.
  - Lines are append-only (update, delete and truncate are blocked) and immutable after closing.
  - Descriptions are sanitized: no long digit sequences and no e-mail.
- `add_manual_payroll_adjustment` works only while the competence is `draft` or `reviewed`. A reason is required, the call is idempotent by key, and it writes an audit event.

## Finance audit
- Append-only. UPDATE, DELETE and TRUNCATE are blocked by trigger, for every role including the owner.
- A reason is required for `approve, adjust, reverse, reopen, pay` and manual adjustments.
- `before_state` and `after_state` are sanitized, with no PII, secrets or ERP identifiers. Salary amounts are not copied into audit.

## Security
- RLS is ON for every new table, with **no policies**: anon and authenticated cannot read or write, and there is no cross-employee salary read.
- No direct DML is allowed for anon or authenticated. `service_role` has SELECT only, with no INSERT, UPDATE, DELETE or TRUNCATE.
- RPCs are `SECURITY DEFINER` with `search_path = public, pg_temp`. They are revoked from PUBLIC, anon and service_role, and granted to `authenticated`. Each one checks internally that the caller is `admin_master` or `admin_financeiro`.
- Concurrency control:
  - Advisory locks on the idempotency key, rule family, employee, employee+date and employee+month.
  - `FOR UPDATE` on the opportunity and the competence.

## Transitions: exist vs forbidden this sprint
| Transition | This sprint |
|---|---|
| rule: create draft, draft → new version (old → superseded), draft → inactive | exists |
| rule: → active, approve, retroactive | **forbidden** |
| entitlement: any creation, accrue, approve, pay | **forbidden** |
| compensation: draft version, draft → inactive | exists |
| compensation: → active | **forbidden** |
| competence: open draft, manual adjustment (draft/reviewed) | exists |
| competence: calculate (automatic), close, pay, reopen | **forbidden / not implemented** |
