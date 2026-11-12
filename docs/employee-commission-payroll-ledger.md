# Employee commission & payroll ledger — foundation (3.1F-I1, hardened in 3.1F-I1B)

Status: **INACTIVE FOUNDATION**. Model, constraints, RLS, grants and internal RPCs only.
No rule is active, nothing is retroactive, nothing is calculated automatically, and nothing has a real financial effect.
This sprint has no forms, dashboards, cron jobs, webhooks, ERP evaluation or payments.

- Migration: `supabase/patch-employee-commission-payroll-ledger-foundation-3-1f-i1.sql`. It is additive, transactional and safe to re-apply, and it has not been applied remotely.
- Preflight/backfill report (read-only): `supabase/preflight-employee-commission-payroll-ledger-3-1f-i1.sql`. Expected backfill is **0**.
- Tests: `npm run test:i1-ledger-foundation` (static), `npm run test:i1-ledger-pg` and `npm run test:i1b-ledger-fixes-pg` (local PostgreSQL labs on 127.0.0.1 only; `IGT_PG_LAB_PORT` / `IGT_PG_LAB_ROOT` select an alternate port and lab directory).
- 3.1F-I1B corrected the original migration file in place (it was never applied remotely); there is no corrective remote patch.

## Conventions
- Money is `numeric(10,2)` in BRL. Floats are never used.
- Percentages are stored as fractions in `numeric(7,6)` (see "Percentages and rounding").
- Instants are `timestamptz` in UTC. Competence months are computed in `America/Sao_Paulo` (`payroll_competence_month_for`). Worked days are `date`.
- A competence starts on the first day of the month and ends on the last day (`payroll_competence_period_end`), covering February in normal and leap years and the December to January rollover.
- Every financial FK uses `ON DELETE RESTRICT`, or `SET NULL` for actor/profile columns. There is no cascade.

## Entities

| Entity | Purpose | Key uniqueness |
|---|---|---|
| `sales_opportunity_attributions` (existing, extended) | Employee ↔ employee-origin opportunity, by role (append-only) | `UNIQUE (opportunity_id, attribution_role)` (kept); `UNIQUE (opportunity_id, employee_id)` (I1B); `idempotency_key` partial unique |
| `employee_commission_rules` | Versioned commission rules (draft only) | `(rule_family_id, version)`, `idempotency_key` |
| `employee_commission_entitlements` | Future commission rights (creation blocked) | `(opportunity_id, employee_id, attribution_role, trigger_kind, rule_id)` where not a reversal; `idempotency_key` |
| `employee_compensation_profiles` | Versioned salary/benefit configuration (draft only) | `(employee_id, version)`, `idempotency_key` |
| `employee_worked_days` | Worked or absent days per employee | `(employee_id, work_date)` |
| `payroll_competences` | Monthly competence per employee | `(employee_id, competence_month)` where `is_current`; `(employee_id, competence_month, version)` |
| `payroll_competence_lines` | Competence lines (append-only, explicit FK references) | `idempotency_key`; one meal line per worked day; one reversal per line; one line per adjustment audit event |
| `finance_audit_events` | Append-only financial audit | `idempotency_key` (partial) |

### Attribution roles (mapping)
| Business role | Stored `attribution_role` | Compatible sector code |
|---|---|---|
| technician | `technician_originator` | `technician` |
| external sales | `external_sales_originator` | `external_sales` |
| commercial / internal responsible | `internal_sales_responsible` (existing proven name; no alias) | `commercial` |

### Attribution rule (frozen product decision, 3.1F-I1B)
1. An opportunity has up to three roles: `technician_originator`, `external_sales_originator`, `internal_sales_responsible`.
2. Each role has at most one employee: `UNIQUE (opportunity_id, attribution_role)`.
3. The same employee holds at most **one** compensable role per opportunity: `UNIQUE (opportunity_id, employee_id)`. The RPC returns `employee_already_attributed`; a direct insert fails with a unique violation.
4. If one person performed several functions, Admin/Financeiro picks the primary role. Commissions are never stacked automatically; any difference is a future audited financial adjustment. There is no override this sprint.
5. There is no reassignment. Rows are **append-only**: a BEFORE UPDATE/DELETE trigger and a BEFORE TRUNCATE trigger reject every change (including `opportunity_id, employee_id, attribution_role, source, idempotency_key, attributed_at, attributed_by, created_at`) for every role, the table owner included. No administrative column needs to change in this foundation. A future reassignment needs a dedicated RPC with a reason and an audit event.
- Production had 0 attributions at the I2 read-only preflight, so the new unique key needs no backfill. The preflight counts `(opportunity_id, employee_id)` and `(opportunity_id, attribution_role)` duplicates; any duplicate requires a manual decision, never an automatic fix.
- Existing production paths only INSERT attributions (`create_employee_sales_opportunity`, H1); no application code or RPC updates or deletes them.
- Side effect: `attributed_by` keeps its H1 FK `ON DELETE SET NULL`. Because the row is immutable, deleting a profile that attributed an opportunity now fails (deactivate the profile instead). The same already applies to `finance_audit_events.actor_id`.

## Commission rules
- Methods and triggers:
  - `fixed_amount` and `percentage` use `first_valid_invoice_generated`.
  - `first_invoice_value` uses `first_valid_invoice_fully_paid`.
  - Any other combination is rejected by a CHECK.
- `fixed_amount` must be greater than 0, with no rate and no base.
- `percentage` must have `0 < rate <= 1.00`. The 1.00 (100%) bound is a **technical completeness limit**, not a business cap. Rates are stored as fractions, so 0.020000 means 2% (see below).
- `first_invoice_value` accepts neither a fixed amount nor a rate.
- **`percentage_base` remains UNPROVEN.** It is nullable free text while a rule is a draft, and there is no enum of assumed ERP fields. Activating a percentage rule would also require `percentage_base` (CHECK `activation_ready`).
- Statuses: `draft | active | inactive | superseded`.
  - **Foundation gate:** `active = false AND status <> 'active'` and `retroactive = false` are enforced by CHECKs, so no rule can be active this sprint.
  - A later authorized sprint can remove the gate CHECKs.
- Versioning: `version_commission_rule_draft` inserts a new row (version + 1). The previous version only moves `draft → superseded`, and its values, method, trigger and scope are immutable by trigger, even for the table owner. Rules cannot be deleted.
- Future defaults are documentation only and are **not seeded**: technician R$ 30.00 fixed, external sales R$ 50.00 fixed, internal responsible 2%, all with active=false and retroactive=false.

## Percentages and rounding (frozen convention)
- Stored as a fraction in `numeric(7,6)`: 2% = `0.020000`, 1.5% = `0.015000`, 0.125% = `0.001250`, 100% = `1.000000`.
- Valid input: `0 < rate <= 1` with at most 6 decimals (`finance_percentage_rate_valid`). More than 6 decimals is **rejected** (`invalid_percentage_rate`), never silently rounded. The rate is never rounded to 2 decimals.
- Direct owner inserts bypass the RPC check; the `numeric(7,6)` column itself would round a 7th decimal, so only the RPC path is supported.
- Future calculation (no calculation runs this sprint; the pure helper `finance_percentage_amount` is not wired to any RPC):
  - `gross_amount = percentage_base_amount * percentage_rate` (exact `numeric`);
  - `final_amount = round(gross_amount, 2)`.
- PostgreSQL `round(numeric, 2)` rounds half a cent away from zero. Tested: `0.25 × 0.02 = 0.005 → 0.01`, `10.25 × 0.5 = 5.125 → 5.13`, `-10.25 × 0.5 = -5.125 → -5.13` (reversals are symmetric), `0.09 × 0.05 = 0.0045 → 0.00`, `99.99 × 0.00125 = 0.1249875 → 0.12`.
- `numeric` only; no `real`/`double precision` column exists.

## Entitlements
- Statuses: `pending_evidence | accrued | approved | included_in_payroll | paid | reversed | rejected`.
- **Creation is blocked this sprint.** A BEFORE INSERT trigger raises `financial_rules_inactive`, and no RPC inserts entitlements. The migration does not relax this gate.
- Commission applies only when `referrals.origin_kind = 'employee'`.
- Status graph (forward only; anything else, including regression, raises `employee_commission_entitlement_transition_forbidden`):

  | From | Allowed to |
  |---|---|
  | `pending_evidence` | `accrued`, `rejected` |
  | `accrued` | `approved`, `reversed`, `rejected` |
  | `approved` | `included_in_payroll`, `reversed` |
  | `included_in_payroll` | `paid`, `reversed` |
  | `paid`, `reversed`, `rejected` | terminal |

- Identity is always frozen: opportunity, employee, attribution, rule, role, trigger kind, idempotency key, `rule_snapshot`, source, `reversal_of`, currency, `created_at`.
- Once the status is `accrued` or later, **every column** is frozen (amount, competence month, evidence/accrual instants, triggering contract/invoice ids, snapshots, ...). The only exceptions are `status` (by the graph), `updated_at`, `approved_at/approved_by` on the transition into `approved`, and `paid_at/paid_by` on the transition into `paid`. The amount is never recalculated; corrections are future reversal/adjustment rows, never an UPDATE.
- DELETE and TRUNCATE are blocked. The table owner goes through the same trigger.
- `paid` additionally requires approval plus `paid_at`/`paid_by` (CHECKs).
- `triggering_contract_pk` and `triggering_invoice_pk` are opaque digit strings, never used as temporal order.
- Accepted limitation: a superuser with `session_replication_role = replica` skips triggers. There is no defense against a superuser.
- The lab tests the UPDATE trigger with a synthetic fixture inside an isolated transaction that disables only the insert gate and then rolls back; afterwards the gate is enabled and the table has 0 rows.

## Snapshot schemas (closed)
Every snapshot must be a JSON object; unknown keys, nested values or wrong types abort. Free text, PII (name, phone, e-mail, CPF/CNPJ, address), ERP payloads, tokens, cookies, HTTP responses and notes are impossible because no such key exists in any allow-list.

Value types: ids are UUID strings; versions are JSON integers ≥ 1; money is a decimal **string** with up to 2 decimals (avoids JSON float precision loss); rates are decimal strings `0 < x ≤ 1` with up to 6 decimals; dates are `YYYY-MM-DD`; instants are ISO-8601 **with offset**.

| Snapshot | Allowed keys (required in bold) | Notes |
|---|---|---|
| `rule_snapshot` | **ruleId**, **ruleVersion**, **method**, **trigger**, fixedAmount, percentageRate, percentageBase, effectiveFrom, effectiveUntil, **attributionRole**, **currency** | `method`, `trigger`, `attributionRole` are the closed enums of the rules table; `currency = 'BRL'`; `percentageBase` may only be `null` until the base is proven |
| `evidence_snapshot` | evidenceKind, contractIdentityPresent, invoiceIdentityPresent, invoiceGeneratedAt, invoicePaidAt, documentAmount, paidAmount, fullPaymentProven, evidenceSource, evidenceVersion | all optional/nullable; `{}` is valid. `evidenceKind`/`evidenceSource` accept only the foundation placeholders `not_collected` and `manual_review`; they are **not** proof of any ERP field |
| audit `before_state`/`after_state` | attribution_role, reward_created, method, trigger_kind, status, previous_status, active, retroactive, version, meal_eligible, line_type, competence_status, amount | each key has a closed type/enum |
| compensation `snapshot` | version, components{salary,meal,transport,fuel: boolean} | |
| line `snapshot` | manual (boolean) | |
| competence `metadata` | none (`{}` only) | |

ERP fields are not proven: no real snapshot is inserted and no rule is activated.

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
- References are explicit nullable FKs, all `ON DELETE RESTRICT` (no cascade, no SET NULL). The free `source_table`/`source_id` pair was removed. A CHECK requires exactly the references of the line type and NULL for the others:

  | line_type | Required reference | Extra validation (trigger, static SQL) |
  |---|---|---|
  | `commission` | `commission_entitlement_id` | same employee and competence month; entitlement `approved` or `included_in_payroll` |
  | `base_salary`, `transport`, `fuel` | `compensation_profile_id` | profile of the same employee with the component enabled |
  | `meal` | `compensation_profile_id` + `worked_day_id`, `quantity = 1` | one line per worked day: same employee, inside the competence period, `status = worked`, `meal_eligible`; meal enabled on the profile; unique per day |
  | `adjustment`, `other_earning`, `discount` | `adjustment_audit_event_id` | manual audited line: the event is `payroll_adjustment_added` for this competence; one line per event |
  | `reversal` | `reversal_of_line_id` | same employee; original is a positive non-reversal line; amount is exactly the negative of the original; one reversal per line |

- A worked day that already explains a meal line cannot be changed (`worked_day_referenced_by_payroll_line`).
- `add_manual_payroll_adjustment` works only while the competence is `draft` or `reviewed`. A reason is required and the call is idempotent by key. It writes the audit event **first** (entity = the competence) and links the line through `adjustment_audit_event_id`; both are in one block, so a failed line leaves no orphan event.

## Finance audit
- Append-only. UPDATE, DELETE and TRUNCATE are blocked by trigger, for every role including the owner.
- A reason is required for `approve, adjust, reverse, reopen, pay` and manual adjustments.
- `entity_type` is a closed enum and `entity_id` is required. A BEFORE INSERT trigger checks that the entity exists in the matching table with a **static CASE** (no dynamic SQL). Nonexistent ids and wrong type/id combinations are rejected (`finance_audit_entity_not_found`). Targets cannot be deleted (no-delete triggers / FK RESTRICT), so an event never becomes orphaned and never needs deleting.
- `operation_id` is required (`^[A-Za-z0-9_-]{16,128}$`); `idempotency_key` uses the same format when present.
- `before_state` and `after_state` follow the closed allow-list above. Salary amounts are not copied into audit.

## Security
- RLS is ON for every new table, with **no policies**: anon and authenticated cannot read or write, and there is no cross-employee salary read.
- No direct DML is allowed for anon or authenticated. `service_role` has SELECT only, with no INSERT, UPDATE, DELETE or TRUNCATE.
- The seven business RPCs are `SECURITY DEFINER` with `search_path = public, pg_temp`. They are revoked from PUBLIC, anon and service_role, and granted only to `authenticated`. Each one checks internally that the caller is `admin_master` or `admin_financeiro`.
- Every other new function (validators, helpers, trigger functions, `finance_audit_log`, `finance_admin_actor_role`) is revoked from PUBLIC, anon, authenticated **and** service_role. PostgreSQL grants EXECUTE to PUBLIC on CREATE FUNCTION and Supabase default privileges grant new objects to anon/authenticated/service_role, so every revoke is explicit. Triggers still fire without any external grant (tested).
- Grants are plain static statements; the migration contains no `EXECUTE`/`format()` dynamic SQL.
- The RPCs read `auth.uid()`. A future server path must forward the **user's JWT**; no service_role endpoint exists or is planned for these RPCs.
- No DELETE/TRUNCATE grant exists on any new table or on attributions.
- Concurrency control:
  - Advisory locks on the idempotency key, rule family, employee, employee+date and employee+month.
  - `FOR UPDATE` on the opportunity and the competence.

## Transitions: exist vs forbidden this sprint
| Transition | This sprint |
|---|---|
| attribution: create via RPC (one role per employee, one employee per role) | exists |
| attribution: update, delete, reassign | **forbidden** (append-only) |
| rule: create draft, draft → new version (old → superseded), draft → inactive | exists |
| rule: → active, approve, retroactive | **forbidden** |
| entitlement: any creation, accrue, approve, pay | **forbidden** |
| entitlement: status regression, leaving a terminal state, editing after accrued | **forbidden** (trigger) |
| compensation: draft version, draft → inactive | exists |
| compensation: → active | **forbidden** |
| competence: open draft, manual adjustment (draft/reviewed) | exists |
| competence: calculate (automatic), close, pay, reopen | **forbidden / not implemented** |

## Migration lock strategy (release)
- Inside the migration transaction: `SET LOCAL lock_timeout = '1500ms'` and `SET LOCAL statement_timeout = '60s'`.
- The ALTERs on `sales_opportunity_attributions` take a short ACCESS EXCLUSIVE lock (plus SHARE for the unique indexes). If a lock cannot be obtained within 1.5 s, or a statement runs longer than 60 s, the whole transaction aborts and nothing is applied.
- There is no retry inside the migration. A new attempt happens only in a controlled release sprint.
- The lab holds a conflicting lock from a second connection, runs the migration, and asserts the abort, no residue (no new table, column or function) and unchanged financial data.
