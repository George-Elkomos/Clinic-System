# Clinic Accounting Events — The Event → Journal Entry Contract

**Purpose**
The definitive contract: for every business event in the clinic system, exactly what journal
entry is posted. This is the specification the posting callers implement against, and the
document the accountant signs off.

**Scope**
Every event with a ledger consequence, plus the events that deliberately have none. Account
references use the purpose names from
[clinic-chart-of-accounts.md](clinic-chart-of-accounts.md)§3, never hard-coded codes.

**Audience**
Developers implementing Phases 6–13, and the accountant validating the design.

**Related documents**
- *../03-accounting/accounting-events.md* — the reference project's equivalent map
- [clinic-accounting-model.md](clinic-accounting-model.md) — the posting engine
- [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) — the account map
- [clinic-financial-modules.md](clinic-financial-modules.md) — the modules that raise these events

> **Layer 2 document.** Everything here is **[Recommended]** design. Comparisons to the
> reference project retain evidence labels and citations.

---

## 0. Contract rules

**[Recommended]** Every posting in this document obeys these rules without exception.

1. **Idempotency key** is always `{source_type}:{source_id}:{purpose}` — stated per event below.
2. **Exact balance.** Σ debits = Σ credits, to the minor unit. No tolerance.
3. **Dimensions.** Every revenue and expense line carries `branch_id`, `cost_center_id`, and
   where applicable `department_id` and `practitioner_id`.
4. **Party.** Every AR/AP line carries `party_type` + `party_id`. Nothing else does.
5. **Traceability.** Every line carries `charge_id` where one exists.
6. **Reversal** is always a new entry with `reverses_entry_id` set and a mandatory `reason_code`.
7. **Gross revenue always.** Revenue is credited at list price; reductions are separate
   debit-normal contra-revenue lines. **[Confirmed]** the reference project nets discounts into
   the income credit, making them invisible in the ledger
   (*../03-accounting/accounting-events.md*§1.1). This
   contract does not.

---

## 1. Charge capture events

**[Recommended]** Under Option A revenue recognition
([clinic-chart-of-accounts.md](clinic-chart-of-accounts.md)§5), charge capture posts
**nothing** — the ledger consequence begins at invoicing. Under Option B it posts an accrual.

| Event | Option A | Option B |
|---|---|---|
| `ChargeCaptured` | **No entry.** The charge is a billing-domain fact. | Dr `AR_UNBILLED` / Cr `REVENUE_BY_SERVICE_CATEGORY[cat]` at net; contra lines as in §2.1 |
| `ChargeVoided` | **No entry** (never invoiced) | Reverse the accrual |
| `EntitlementConsumed` | **No entry**; the zero-value charge records the fact | Dr `ENTITLEMENT_FORGONE` / Cr revenue at list value, then reverse — or simply no entry |

**[Recommended]** Whichever option, **a charge always exists** even at zero value, so that
delivered care is countable. **[Confirmed]** the reference project's free-follow-up path leaves
no record at all — the appointment is simply excluded from billing
(*../04-modules/healthcare-billing.md*§6).

The remainder of this document assumes **Option A**, which is the recommended default.

---

## 2. Billing events

### 2.1 `InvoiceIssued` — the central posting

**Idempotency key:** `Invoice:{invoice_id}:issue`

For each invoice line, derived from its charge split:

| Line | Account | Dr | Cr | Amount | Condition |
|---|---|---|---|---|---|
| 1 | `REVENUE_BY_SERVICE_CATEGORY[cat]` | | ✔ | `charge.gross_minor` | always — **gross** |
| 2 | `DISCOUNT_POLICY[policy]` | ✔ | | `charge.discount_minor` | discount applied |
| 3 | `CONTRACTUAL_ADJUSTMENT[payer_type]` | ✔ | | split where `basis = CONTRACTUAL_ADJUSTMENT` | insured/corporate line |
| 4 | `TAX_PAYABLE[group]` | | ✔ | `line.tax_minor` | taxable service |
| 5 | `AR_PATIENT` (party: patient) | ✔ | | Σ splits where `payer_type = SELF_PAY` | any self-pay portion |
| 6 | `AR_INSURER` (party: insurer) | ✔ | | Σ splits where `payer_type = INSURER` | insured portion |
| 7 | `AR_CORPORATE` (party: corporate) | ✔ | | Σ splits where `payer_type = CORPORATE` | corporate portion |
| 8 | `ROUNDING` | ✔/✔ | | rounding residue | only if the tax authority requires a rounded total |

**Worked example.** Consultation, list 500.00, 10% policy discount, insurer contract price 400.00,
coverage 80%, copay 50.00, VAT 14% on the patient portion only:

```
gross                 500.00
discount (10%)        −50.00
net                   450.00
contract price        400.00  → contractual adjustment = 50.00
covered basis         400.00 − 50.00 copay = 350.00
insurer (80%)         280.00
patient               450.00 − 50.00 adj − 280.00 = 120.00
                                   (50.00 copay + 70.00 coinsurance)

Dr  AR — Patients                      120.00   party: patient
Dr  AR — Insurers                      280.00   party: insurer
Dr  Discounts — Policy                  50.00
Dr  Contractual Adjustments — Insurers   50.00
    Cr  Consultation Revenue                    500.00
                                       ───────  ───────
                                        500.00   500.00
```

Note that **gross revenue of 500.00 is recognised** and the reductions are visible as separate
debits. **[Confirmed]** the reference project would instead credit revenue 450.00 (discount
netted, invisible), debit the patient 450.00 in full, and then post a *separate corrective
journal* moving 280.00 to the insurer — with no contractual adjustment concept at all
(*../04-modules/healthcare-insurance.md*§6).

### 2.2 Other billing events

| Event | Idempotency key | Dr | Cr | Amount | Notes |
|---|---|---|---|---|---|
| `InvoiceCancelled` | `Invoice:{id}:reverse` | *reverse of 2.1* | | full | Charges → `CAPTURED`; requires reason |
| `CreditNoteIssued` (full) | `CreditNote:{id}:issue` | Revenue, tax | AR (relevant payer) | full | Reverses 2.1 proportionally |
| `CreditNoteIssued` (partial) | ″ | Revenue, tax | AR | partial | Per line |
| `InvoiceWrittenOff` | `Invoice:{id}:writeoff` | `BAD_DEBT_PATIENT` / `BAD_DEBT_PAYER` | AR (relevant payer) | outstanding | Requires approval above threshold |
| `LateFeeCharged` | `Invoice:{id}:latefee` | `AR_PATIENT` | `4940 No-Show/Late Fees` | fee | Optional policy |

---

## 3. Cash & payment events

| Event | Idempotency key | Dr | Cr | Amount | Notes |
|---|---|---|---|---|---|
| `PaymentReceived` — cash | `Payment:{id}:receipt` | `CASH_BY_TILL[till]` | AR (payer) | amount | Allocation determines which invoice |
| `PaymentReceived` — card/gateway | ″ | `GATEWAY_CLEARING[gw]` | AR (payer) | amount | Not yet in the bank |
| `GatewaySettled` | `Settlement:{batch}:settle` | `BANK_DEFAULT` | `GATEWAY_CLEARING[gw]` | gross | |
| `GatewayFeeCharged` | `Settlement:{batch}:fee` | `5470 Bank & Gateway Charges` | `GATEWAY_CLEARING[gw]` | fee | Often netted in the same settlement |
| `PaymentReceived` — bank transfer | `Payment:{id}:receipt` | `BANK_DEFAULT` | AR (payer) | amount | |
| `PaymentUnallocated` (advance) | ″ | cash/bank | `PATIENT_CREDIT_BALANCE` | unallocated | Liability, not revenue |
| `DepositTaken` | `Deposit:{id}:take` | cash/bank | `PATIENT_DEPOSIT_LIABILITY` | amount | **Never revenue** |
| `DepositApplied` | `Deposit:{id}:apply:{invoice}` | `PATIENT_DEPOSIT_LIABILITY` | `AR_PATIENT` | applied | |
| `DepositRefunded` | `Deposit:{id}:refund` | `PATIENT_DEPOSIT_LIABILITY` | cash/bank | refunded | |
| `RefundIssued` | `Refund:{id}:pay` | `AR_PATIENT` or `PATIENT_CREDIT_BALANCE` | cash/bank | amount | Must not exceed received |
| `PaymentReversed` (bounced/chargeback) | `Payment:{id}:reverse` | *reverse of receipt* | | amount | Reason mandatory |
| `CashierShiftClosed` — variance | `Shift:{id}:variance` | `CASH_VARIANCE` (short) / `CASH_BY_TILL` (over) | opposite | `counted − expected` | **Posted, not just recorded.** **[Ambiguous]** in the reference project |
| `CashDeposited` to bank | `Deposit:{id}:banking` | `BANK_DEFAULT` | `CASH_BY_TILL[till]` | amount | |

**[Recommended]** `PaymentAllocation` changes do **not** post. Allocation determines which
invoice's AR is credited; changing it is a reversal plus a re-post, never an `UPDATE`.
**[Confirmed]** the reference project does
`UPDATE tabGL Entry SET against_voucher = null` in `unlink_ref_doc_from_payment_entries`
(*../02-architecture/module-boundaries.md*§3.2).

---

## 4. Payer / claim events

**[Recommended]** The insurer receivable already exists from §2.1 line 6. Claims do **not**
create the receivable — they track its adjudication. This is the single largest departure from
the reference project, where the insurer receivable is created by a post-hoc journal entry
(*../04-modules/healthcare-insurance.md*§6).

| Event | Idempotency key | Dr | Cr | Amount | Notes |
|---|---|---|---|---|---|
| `ClaimSubmitted` | — | | | | **No entry.** Status change only. |
| `ClaimApprovedInFull` | — | | | | **No entry.** The AR already stands. |
| `ClaimApprovedPartially` | `Claim:{id}:shortfall` | one of: `CONTRACTUAL_ADJUSTMENT`, `AR_PATIENT`, `BAD_DEBT_PAYER` | `AR_INSURER` | `claimed − approved` | **The disposition is an explicit decision.** Never nothing. |
| `ClaimDenied` — to patient | `Claim:{id}:to_patient` | `AR_PATIENT` (party: patient) | `AR_INSURER` (party: insurer) | denied amount | Patient becomes responsible |
| `ClaimDenied` — written off | `Claim:{id}:denial_writeoff` | `DENIAL_WRITE_OFF` | `AR_INSURER` | denied amount | Requires approval |
| `ClaimDenied` — under appeal | — | | | | **No entry.** AR remains; flagged for follow-up. |
| `RemittanceReceived` | `Remittance:{id}:receipt` | `BANK_DEFAULT` | `AR_INSURER` (party: insurer) | received | Allocated across claims |
| `RemittanceVariance` | `Remittance:{id}:variance` | `CONTRACTUAL_ADJUSTMENT` or `BAD_DEBT_PAYER` | `AR_INSURER` | unexplained residue | Must be dispositioned |
| `PayerOverpaid` | `Remittance:{id}:overpay` | `BANK_DEFAULT` | `PAYER_OVERPAYMENT` (2230) | excess | Liability until refunded |

> **[Recommended] The rule that fixes the reference project's worst behaviour:**
> **every denied or unapproved amount must reach one of three destinations — patient
> responsibility, appeal (AR retained), or write-off. It may never simply disappear.**
> **[Confirmed]** in the reference project, a `Pending` or `Rejected` claim causes the
> collector to append the service to *neither* list, so the delivered care is never billed to
> anyone and no warning is raised
> (*../04-modules/healthcare-insurance.md*§8).

---

## 5. Inventory & pharmacy events

| Event | Idempotency key | Dr | Cr | Amount | Notes |
|---|---|---|---|---|---|
| `StockReceived` | `Receipt:{id}:receive` | `INVENTORY_BY_CATEGORY[cat]` | `1340 Inventory Received Not Billed` | valuation | Perpetual inventory |
| `SupplierInvoiceMatched` | `SupplierInvoice:{id}:issue` | `1340` + tax | `AP_SUPPLIER` (party: supplier) | invoice total | |
| `MedicationDispensed` | `Dispense:{id}:cogs` | `COGS_BY_CATEGORY[cat]` | `INVENTORY_BY_CATEGORY[cat]` | valuation | **Separate** from the revenue charge |
| ″ (revenue side) | via `Invoice:{id}:issue` | AR | `4160 Pharmacy Revenue` | selling price | Two distinct entries |
| `ConsumablesConsumed` | `Consumption:{id}:cogs` | `5120` | `1320` | valuation | |
| `StockAdjusted` | `Adjustment:{id}:post` | `5630 Inventory Write-off` or inventory | opposite | difference | Reason mandatory |
| `StockExpired` | `Expiry:{id}:writeoff` | `5630` | inventory | valuation | |

**[Recommended]** Cost and revenue are **two separate entries** with different idempotency
keys. Never combine them — they have different timing, different reversal conditions, and
different owners.

---

## 6. Expense & payables events

| Event | Idempotency key | Dr | Cr | Amount |
|---|---|---|---|---|
| `SupplierInvoiceIssued` | `SupplierInvoice:{id}:issue` | expense or inventory + recoverable tax | `AP_SUPPLIER` (party) | total |
| `SupplierPaymentMade` | `Payment:{id}:pay` | `AP_SUPPLIER` (party) | bank/cash | amount |
| `PractitionerFeeAccrued` | `PractitionerFee:{id}:accrue` | `5150 Practitioner Fees` | `AP_PRACTITIONER` (party) | fee |
| `PractitionerFeePaid` | `Payment:{id}:pay` | `AP_PRACTITIONER` (party) | bank | amount |
| `PayrollAccrued` | `Payroll:{run}:accrue` | `5210`/`5220`/`5230` per component | `2141 Salaries Payable`, `2142` deductions | gross |
| `PayrollPaid` | `Payroll:{run}:pay` | `2141` | bank | net |
| `ExpenseClaimApproved` | `ExpenseClaim:{id}:approve` | expense accounts | `2110` (party: employee) | sanctioned |
| `DepreciationPosted` | `Asset:{id}:depreciation:{period}` | `5510`/`5520` | `1511`/`1521`/`1531` | schedule amount |
| `AssetDisposed` | `Asset:{id}:dispose` | accum. depreciation + loss, or gain | asset cost | book value vs proceeds |

---

## 7. Period & adjustment events

| Event | Idempotency key | Dr | Cr | Amount | Notes |
|---|---|---|---|---|---|
| `PeriodClosed` | — | | | | **No entry.** Status change only. |
| `YearEndClosed` | `FiscalYear:{id}:close` | each P&L account with a credit balance | each with a debit balance | `abs(balance)` per account **per dimension** | Balanced to `RETAINED_EARNINGS`. Copies the reference project's logic, which is correct (`period_closing_voucher.py`) |
| `OpeningBalanceLoaded` | `Migration:{batch}:opening` | asset/expense accounts | liability/equity accounts | opening | P&L accounts rejected |
| `ManualAdjustment` | `Adjustment:{id}:post` | as entered | as entered | as entered | Reason + approval mandatory; restricted role |
| `FXRevaluation` | `Revaluation:{id}:post` | `4960` or `5620` | affected account | difference | Only if multi-currency |

---

## 8. Events that deliberately post nothing

**[Recommended]** This list is part of the contract. Anything not on it and not in §1–7 is an
unspecified event and must be specified before it is built.

| Event | Why nothing posts | What it does affect |
|---|---|---|
| Appointment booked / cancelled | No service rendered | No-show fee policy may create a charge |
| Clinical order placed | Not yet performed | Nothing financial |
| `ChargeCaptured` (Option A) | Revenue recognised at invoicing | Unbilled-charges integrity job |
| `ChargeVoided` | Never invoiced | Audit trail only |
| `EntitlementConsumed` | Zero-value charge records it | Revenue-forgone reporting |
| Claim submitted / approved in full | AR already exists from invoicing | Claim ageing |
| Claim under appeal | AR retained deliberately | Follow-up queue |
| Payment allocation changed | Allocation is not a posting | Which invoice's AR is credited |
| Bank reconciliation match | Only marks a transaction reconciled | Bank reconciliation statement |
| Period closed | Status change | Blocks future posting |
| Price list change | Historical charges keep their captured price | Future charges only |
| Coverage rule change | Existing splits are stored, not recomputed | Future charges only |
| Patient or payer master edit | No financial fact changed | — |

---

## 9. Validation checklist for the accountant

**[Recommended]** Walk these before implementation begins. Each should be answerable from
§1–8 alone.

- [ ] Is revenue recognised at the right moment? (§1, and §5 of [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md))
- [ ] Is gross revenue visible, with discounts and contractual adjustments as separate contra lines? (§2.1)
- [ ] Does every insured line create both a patient and an insurer receivable at invoicing? (§2.1)
- [ ] Can a denied claim ever result in no accounting entry and no patient balance? (§4 — the answer must be *no*)
- [ ] Are patient deposits a liability until applied? (§3)
- [ ] Is card money distinguished from banked money? (§3)
- [ ] Is till variance posted? (§3)
- [ ] Are pharmacy cost and pharmacy revenue separate entries? (§5)
- [ ] Does year-end close preserve branch/department/practitioner analysis? (§7)
- [ ] Is every correction reversible, reasoned, and attributable? (§0.6)

---

## Open questions / unverified

1. **Revenue recognition option** (§1) is unresolved — decide in Phase 0.
2. **Tax on the insurer vs the patient portion** (§2.1 worked example applies VAT to the
   patient portion only). This is jurisdiction-specific and must be confirmed; healthcare
   services are frequently exempt or zero-rated.
3. **Whether gateway fees are netted or gross-settled** (§3) depends on the provider's
   settlement model.
4. **Contractual adjustment timing** — §2.1 recognises it at invoicing, from the contract
   price. If a payer's actual adjudication differs, §4's `ClaimApprovedPartially` handles the
   delta. An alternative is to recognise no adjustment until adjudication, which delays
   net-revenue accuracy. Not resolved here.
5. **Practitioner fee accrual timing** (§6) — at service delivery or at period end — is a
   contract-terms question.
6. **Payroll component mapping** (§6) is sketched; the full salary-component-to-account map
   depends on the payroll design, which is out of scope for this document set.
