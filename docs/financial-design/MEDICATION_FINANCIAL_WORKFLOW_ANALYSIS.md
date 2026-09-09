# Medication → Dispensing → Inventory → Billing → Payment → Accounting

**A source-traced analysis of the ERPNext-Healthcare reference project**

| | |
|---|---|
| **Reference repository** | `C:\Users\el awael\erpnext-healthcare` — a fork of **ERPNext v13.0.0-dev** (Python/JavaScript on the Frappe metadata framework), branch `develop` |
| **Purpose of this document** | Establish exactly how the reference project handles medications commercially — and above all, **what event makes a medication billable** — so the Clinic Management System can be designed deliberately rather than by imitation |
| **Status** | Analysis only. No file in the reference repository was created, modified or deleted. |
| **Date** | 2026-09-07 |

> **How to read the evidence labels.** Every substantive claim carries one:
>
> | Label | Meaning |
> |---|---|
> | **[Confirmed]** | Read directly in the source. A file and line reference accompanies it. |
> | **[Inference]** | Reasoned from confirmed facts. The basis is always stated. |
> | **[Not Found]** | Searched for and absent. The search performed is stated. |
> | **[Cannot be determined]** | The code permits more than one reading, or depends on the Frappe framework, which is **not present in the reference repository** (`requirements.txt` lists it unpinned). |
>
> Source paths are written relative to the reference repository root, e.g. `erpnext/healthcare/utils.py:702`. They do not resolve inside this repository.

---

## Table of contents

1. [The answer in one page](#1-the-answer-in-one-page)
2. [The medication domain — every entity](#2-the-medication-domain--every-entity)
3. [The complete prescription lifecycle](#3-the-complete-prescription-lifecycle)
4. [The billing trigger, traced to the line](#4-the-billing-trigger-traced-to-the-line)
5. [Partial dispensing](#5-partial-dispensing)
6. [Cancellation](#6-cancellation)
7. [Medication returns](#7-medication-returns)
8. [Inventory ↔ accounting relationship](#8-inventory--accounting-relationship)
9. [Pricing](#9-pricing)
10. [Invoice / charge structure](#10-invoice--charge-structure)
11. [Roles and permissions](#11-roles-and-permissions)
12. [Database-level analysis](#12-database-level-analysis)
13. [API / service-level analysis](#13-api--service-level-analysis)
14. [Frontend workflow](#14-frontend-workflow)
15. [Financial event timeline](#15-financial-event-timeline)
16. [Edge cases — supported / partial / not supported](#16-edge-cases--supported--partial--not-supported)
17. [Accounting interpretation](#17-accounting-interpretation)
18. [Critical finding](#18-critical-finding)
19. [Recommendations for the clinic system](#19-recommendations-for-the-clinic-system)
20. [Evidence index](#20-evidence-index)

---

## 1. The answer in one page

**A medication becomes financially billable the moment the doctor submits the Patient Encounter — the clinical act of *ordering*. Dispensing plays no part in billing whatsoever, because outpatient dispensing does not exist in this system.**

**[Confirmed]** `PatientEncounter.on_submit` (`erpnext/healthcare/doctype/patient_encounter/patient_encounter.py:23-27`) calls `create_healthcare_service_order(self)`, which creates one **`Healthcare Service Order`** row per prescribed drug (`patient_encounter.py:138-166`). That order carries `invoiced = 0`, and from that instant it is returned by the billing collector `get_healthcare_service_orders_to_invoice` (`erpnext/healthcare/utils.py:389-419`) and is eligible to be pulled onto a Sales Invoice.

Nothing between the prescription and the invoice checks whether the drug was ever handed to the patient. There is no dispensing document, no pharmacy screen, no pharmacist role, and no stock movement on the outpatient path.

**[Confirmed]** The word **`dispense`** does not appear anywhere in the healthcare module:

```
grep -rni "dispensed\|dispense" --include=*.py --include=*.json --include=*.js erpnext/healthcare/
→ zero matches
```

Three structural facts follow, and they govern everything in this document:

| # | Fact | Evidence |
|---|---|---|
| 1 | **Medications are sold as services, not goods.** Every drug's `Item` is auto-created with `is_stock_item: 0` and `is_purchase_item: 0`. | `erpnext/healthcare/doctype/medication/medication.py:56-70` |
| 2 | **The prescription line itself holds no billing state.** `Drug Prescription` has no `invoiced`, no `status`, no `rate`, no `amount` — unlike all three of its sibling prescription tables. | `erpnext/healthcare/doctype/drug_prescription/drug_prescription.json` |
| 3 | **Two rival billing paths exist and are unaware of each other.** One is stateful and idempotent; the other records nothing and can be re-run without limit. | `utils.py:389-419` vs `utils.py:702-727` |

The complete chain, ahead of the detailed trace in §4:

```
Doctor types drug rows into a grid on Patient Encounter
        │
        ▼  submit  (docstatus 0 → 1)
Patient Encounter.on_submit
        │
        ▼  create_healthcare_service_order()          patient_encounter.py:138-166
Healthcare Service Order  (one per drug, order_doctype='Medication', invoiced=0)
        │                                              ← THE BILLABLE UNIT IS CREATED HERE
        │                        (if insured: Healthcare Insurance Claim created + submitted,
        │                         freezing price_list_rate, discount, coverage)
        ▼  someone opens a Sales Invoice and clicks "Get Items From → Healthcare Services"
get_healthcare_service_orders_to_invoice()             utils.py:389-419
        │   gate: Medication.is_billable  (default 0)
        ▼
SalesInvoice.set_healthcare_services()                 sales_invoice.py:1295-1342
        │   builds Sales Invoice Item with reference_dt='Healthcare Service Order'
        ▼  submit
Sales Invoice  ─┬─► GL Entry:  Dr Debtors / Cr Income          ← THE FINANCIAL RECORD
                └─► manage_invoice_submit_cancel → set_invoiced → HSO.invoiced = 1
        │
        ▼
Payment Entry (or POS payment row)  →  Dr Cash-Bank / Cr Debtors
```

---

## 2. The medication domain — every entity

### 2.1 Inventory of what exists

**[Confirmed]** by directory listing of `erpnext/healthcare/doctype/` plus schema reads:

| Concept | Implemented as | Status |
|---|---|---|
| Medication master | `Medication` | **IMPLEMENTED** |
| Drug classification | `Medication Class`, `Medication Class Interaction`, `Drug Interaction` | **IMPLEMENTED** (last is orphaned) |
| Dosage reference data | `Dosage Form`, `Prescription Dosage`, `Dosage Strength`, `Prescription Duration` | **IMPLEMENTED** |
| Prescription line | `Drug Prescription` (child table of `Patient Encounter`) | **IMPLEMENTED** |
| Prescription header | *(none — the `Patient Encounter` is the header)* | **NOT IMPLEMENTED as a distinct entity** |
| Medication order | `Healthcare Service Order` with `order_doctype='Medication'` | **IMPLEMENTED** |
| Inpatient medication schedule | `Inpatient Medication Order` + `Inpatient Medication Order Entry` | **IMPLEMENTED** |
| Inpatient administration | `Inpatient Medication Entry` + `Inpatient Medication Entry Detail` | **IMPLEMENTED** |
| Pharmacy | — | **NOT IMPLEMENTED** |
| Dispensing (outpatient) | — | **NOT IMPLEMENTED** |
| Medication inventory | Generic ERPNext `Item`/`Warehouse`/`Stock Entry`, but drug Items are non-stock | **PARTIALLY IMPLEMENTED** |
| Medication stock transaction | `Stock Entry` (`Material Issue`), inpatient only | **PARTIALLY IMPLEMENTED** |
| Medication status | — | **NOT IMPLEMENTED** |
| Prescription status | — | **NOT IMPLEMENTED** |
| Refills | — | **NOT IMPLEMENTED** |
| Returns | — | **NOT IMPLEMENTED** |
| Cancellations | Document-level `docstatus` only | **PARTIALLY IMPLEMENTED** |
| Adjustments | — | **NOT IMPLEMENTED** |

**[Not Found]** Searches proving the absences:

```
grep -rni "pharmacist"  (whole repo, excluding erpnext/regional/india/hsn_code_data.json)  → 0
grep -rni "pharmacy"    (whole repo, excluding erpnext/regional/)                          → 0
grep -rni "dispense|dispensed"  erpnext/healthcare/                                        → 0
grep -rn  "refill"      erpnext/healthcare/                                                → 0
grep -rn  "Workflow"    erpnext/healthcare/                                                → 0
ls erpnext/healthcare/page/  → patient_history, patient_progress only
```

### 2.2 `Medication` — the master that owns an Item

**[Confirmed]** `erpnext/healthcare/doctype/medication/medication.json`, `autoname: format:{medication_name}`, not submittable.

Financially relevant fields:

| Field | Type | Notes |
|---|---|---|
| `medication_name` | Data, **reqd** | Becomes the document name **and** the `Item.item_code` |
| `item` | Link → Item, **read-only** | Written by `db_set` after the Item is created |
| `item_code` | Data, **reqd** | **[Confirmed] Never used to create the Item** — decorative |
| `item_group` | Link → Item Group, reqd | Passed to the Item |
| `stock_uom` | Link → UOM, reqd | Passed to the Item; also the gate in `get_drugs_to_invoice` |
| **`is_billable`** | Check, **default `0`** | **The billability gate for the entire HSO path** |
| **`rate`** | **Float** (not Currency), `mandatory_depends_on: is_billable` | Pushed to `Item Price.price_list_rate` |
| `disabled` | Check | Mirrored onto `Item.disabled` |
| `healthcare_service_order_category` | Link, reqd | Copied to the Healthcare Service Order |
| `staff_role`, `patient_care_type` | Link | Copied to the Healthcare Service Order |
| `change_in_item` | Check, hidden | Dirty flag that gates Item/Item-Price resync |

**[Confirmed]** The Item is created in `after_insert` (`medication.py:50-73`):

```python
def create_item_from_medication(doc):
	disabled = doc.disabled
	if doc.is_billable and not doc.disabled:
		disabled = 0

	uom = doc.stock_uom or frappe.db.get_single_value('Stock Settings', 'stock_uom')
	item = frappe.get_doc({
		'doctype': 'Item',
		'item_code': doc.medication_name,
		'item_name':doc.medication_name,
		'item_group': doc.item_group,
		'description':doc.description,
		'is_sales_item': 1,
		'is_service_item': 1,
		'is_purchase_item': 0,
		'is_stock_item': 0,          # ← medications are NON-STOCK
		'show_in_website': 0,
		'is_pro_applicable': 0,
		'disabled': disabled,
		'stock_uom': uom
	}).insert(ignore_permissions=True, ignore_mandatory=True)

	make_item_price(item.name, doc.rate)
	doc.db_set('item', item.name)
```

**[Confirmed]** `is_stock_item: 0` and `is_purchase_item: 0` together mean a medication, as provisioned, **cannot be purchased into stock, cannot be counted, and cannot be issued from a warehouse**. §8 shows why this collides with the inpatient path.

**[Confirmed]** `Medication.name == Item.item_code` by construction (autoname is `format:{medication_name}`, and the Item is keyed on the same value). Several code paths depend on this identity — `get_drugs_to_invoice` passes a `Medication` link straight into `frappe.db.get_value('Item', ...)` (`utils.py:713`).

**[Confirmed]** `change_item_code_from_medication` (`medication.py:83-92`) renames the **Item only** and writes `Medication.item_code`; the `Medication` document is not renamed. **[Inference]** — basis: `rename_doc('Item', …)` is called without a corresponding `rename_doc('Medication', …)` — this breaks the name identity above, after which `get_drugs_to_invoice`'s `get_value('Item', drug_code, 'stock_uom')` returns `None` and the quantity silently falls back to 1.

**[Cannot be determined]** `Medication.validate` → `enable_disable_item` (`medication.py:22-27`) runs on every save including the first, when `self.item` is still empty, issuing `frappe.db.set_value('Item', None, 'disabled', …)`. What Frappe does with a `None` document name is not observable here, because the framework is not in the repository.

### 2.3 `Drug Prescription` — the prescription line

**[Confirmed]** `erpnext/healthcare/doctype/drug_prescription/drug_prescription.json`, `istable: 1`, `permissions: []` (child tables inherit the parent's permissions).

Complete field list: `drug_code` (Link → **Medication**, reqd), `drug_name`, `dosage` (Link → Prescription Dosage, reqd), `period` (Link → Prescription Duration, reqd), `dosage_form` (reqd), `comment`, `usage_interval` (Check, **hidden**), `interval` (Int, `depends_on: usage_interval`), `interval_uom`, `update_schedule` (Check, hidden), `intent`, `quantity` (Int), `sequence`, `expected_date`, `as_needed`, `patient_instruction`, `replaces`, `priority`, `occurrence`, `occurence_period` *(sic)*, `note`.

**The central contrast.** **[Confirmed]** by dumping the three sibling child tables:

| | **Drug Prescription** | Lab Prescription | Procedure Prescription |
|---|---|---|---|
| `invoiced` | **ABSENT** | present | present |
| `<x>_created` fulfilment flag | **ABSENT** | `lab_test_created` | `procedure_created` |
| Back-link to the executed document | **ABSENT** | `lab_test` | `clinical_procedure` |
| Branch in `set_invoiced()` | **ABSENT** | `utils.py:626-627` | `utils.py:629-630` |
| Any financial field | **ABSENT** | — | — |

**[Confirmed]** `Drug Prescription` is the only prescription child table with **neither billing state nor fulfilment state**. There is nowhere on a prescribed drug to record that it was billed, dispensed, or administered.

**[Confirmed]** `drug_prescription.py` contains exactly one method — `get_quantity()` (`drug_prescription.py:10-34`) — and no `validate`:

```python
def get_quantity(self):
	quantity = 0
	if self.dosage:
		dosage = frappe.get_doc('Prescription Dosage', self.dosage)
		for item in dosage.dosage_strength:
			quantity += item.strength
		if self.period and self.interval:
			period = frappe.get_doc('Prescription Duration', self.period)
			if self.interval < period.get_days():
				quantity = quantity * (period.get_days()/self.interval)
	elif self.interval and self.interval_uom and self.period:
		...
	if quantity > 0:
		return quantity
	else:
		return 1
```

**[Confirmed]** The duration multiplier only applies when `self.interval` is truthy. `interval` depends on `usage_interval`, which is `hidden: 1`. **[Inference]** — basis: a hidden checkbox defaulting to `0` is not set in the ordinary UI, so `interval` is normally empty and **the quantity returned is a single day's doses regardless of a 30-day `period`**. The `elif` branch is unreachable because `dosage` is `reqd: 1`.

**[Confirmed]** The stored `quantity` field is dead. Both consumers call the *method*: `utils.py:714` and `patient_encounter.py:155`.

### 2.4 `Healthcare Service Order` — the actual billable unit

**[Confirmed]** `erpnext/healthcare/doctype/healthcare_service_order/healthcare_service_order.json`. **Not submittable** (`is_submittable` absent).

| Field | Type | Role |
|---|---|---|
| `order_doctype` | Link → DocType | `'Medication'` for drugs |
| `order` | Dynamic Link | The `Medication` name |
| `billing_item` | Link → Item, **read-only, reqd**, `fetch_from: order.item` | The Item that will be invoiced |
| `quantity` | Float | From `drug.get_quantity()` |
| **`invoiced`** | Check, read-only | **The only billing state a medication ever has** |
| `status` | Select: `Draft / Active / On Hold / Revoked / Completed / Replaced / Error / Unknown / Waiting` | **Never advanced for medications** |
| `insurance_claim`, `claim_status` | Link / Select | Set by `after_insert` |
| `order_group` | Data | The originating Patient Encounter name |
| `patient`, `company`, `ordered_by`, `order_date` | | |

**[Confirmed]** The entire controller is 28 lines (`healthcare_service_order.py`):

```python
class HealthcareServiceOrder(Document):
	def after_insert(self):
		make_insurance_claim(self)
	def validate(self):
		self.set_title()
		if self.insurance_subscription and self.claim_status == 'Pending':
			self.status = 'Waiting'
```

**[Confirmed]** No `on_submit`, no fulfilment hook, no dispense method. **[Confirmed]** Grepping every write to HSO `status` repo-wide finds only `lab_test.py:55,157,357`, `clinical_procedure.py:48`, `radiology_examination.py:16` and the `Waiting` line above — **nothing keyed on `order_doctype == 'Medication'` ever advances a drug order's status**. A medication order is created at `Draft` and stays there permanently; the only field that ever changes is `invoiced`.

### 2.5 The inpatient medication pair

**[Confirmed]** `Inpatient Medication Order` (IMO) — submittable, `naming_series: HLC-IMO-.YYYY.-`. Fields: `patient_encounter`, `patient`, `inpatient_record` (reqd), `practitioner`, `start_date`, `end_date`, `medication_orders` (child table), `company`, `status`, `total_orders`, `completed_orders`. **No price, rate, amount, account or `invoiced` field.**

Status is derived, not chosen (`inpatient_medication_order.py:43-58`):

```python
def set_status(self):
	status = {"0": "Draft", "1": "Submitted", "2": "Cancelled"}[cstr(self.docstatus or 0)]
	if self.docstatus == 1:
		if not self.completed_orders:      status = 'Pending'
		elif self.completed_orders < self.total_orders:  status = 'In Process'
		else:                              status = 'Completed'
	self.db_set('status', status)
```

**[Inference]** `"Submitted"` is a declared but unreachable option — basis: the `docstatus == 1` block always overwrites it.

**[Confirmed]** Child `Inpatient Medication Order Entry`: `drug` (Link → **`Item`**, reqd), `drug_name`, `dosage` (**Float**, reqd), `dosage_form`, `date`, `time`, `is_completed` (Check), `instructions`.

> **[Confirmed] A type mismatch sits at the heart of this table.** `Inpatient Medication Order Entry.drug` links to **`Item`**, while `Drug Prescription.drug_code` links to **`Medication`**. The encounter mapper writes `order.drug = entry.drug_code` (`patient_encounter.py:51`) — a Medication name into an Item field. It resolves only through the naming coincidence of §2.2. The manual "Add Medication Orders" dialog, meanwhile, filters `{'is_stock_item': 1}` (`inpatient_medication_order.js:36`) — so drugs provisioned by `Medication` (`is_stock_item: 0`) **cannot be selected there at all**, while the mapper inserts them freely.

**[Confirmed]** `Inpatient Medication Entry` (IME) — submittable. Header: `company`, `posting_date`, `status` (**dead — no code ever writes it**), filter fields (`item_code`, `patient`, `practitioner`, `service_unit`, `from_date`/`to_date`, `from_time`/`to_time`, `assigned_to_practitioner`), `medication_orders` (child, reqd), `update_stock` (Check, **default 1**), `warehouse` (`mandatory_depends_on: update_stock`).

**[Confirmed]** There is exactly **one** warehouse field and it is a source. There is no target warehouse, no ward stock location. The drug leaves inventory into an expense account.

**[Confirmed]** Child `Inpatient Medication Entry Detail`: `patient` (reqd), `inpatient_record`, `service_unit` (reqd), `datetime` (reqd), `drug_code` (Link → Item, reqd), `drug_name`, `dosage` (Float, reqd), `dosage_form`, `instructions`, `available_qty` (hidden, **never written**), `against_imo` (Link → IMO), `against_imoe` (**Data**, not a Link — no referential integrity).

### 2.6 Entity relationship map

```
                    Medication  ──1:1──►  Item  ──1:n──►  Item Price
                    (master)              (is_stock_item = 0)   (price_list_rate)
                        ▲
                        │ drug_code (Link)
                        │
Patient Encounter ──1:n──► Drug Prescription        [no invoiced, no status, no price]
        │                        │
        │ on_submit              │ (fields copied, not linked)
        ▼                        ▼
Healthcare Service Order  ◄──────┘                  [invoiced flag, billing_item, quantity]
        │  order_doctype='Medication', order=<Medication>
        │
        ├──after_insert──► Healthcare Insurance Claim   [price snapshot, submitted]
        │
        └──reference_dn──► Sales Invoice Item ──► Sales Invoice ──► GL Entry
                                                        │
                                                        └──► Payment Entry ──► GL Entry

        (manual button, inpatients only)
Patient Encounter ──► Inpatient Medication Order ──► Inpatient Medication Entry ──► Stock Entry
                       (per-dose expansion)            (Material Issue)              │
                                                                                     ▼
                                                                    SLE  +  GL (perpetual only)
                                                             *** no link to any invoice ***
```

**[Confirmed]** The two halves of that diagram never meet. There is no foreign key, no flag, and no report connecting the inpatient stock chain to the billing chain.

---

## 3. The complete prescription lifecycle

This is the **actual** flow, not an assumed one.

### Stage 1 — Prescribing

| | |
|---|---|
| **Who** | A user with the **`Physician`** role — the only role on `Patient Encounter` (`patient_encounter.json` permissions) |
| **UI** | An inline child-table grid on the Patient Encounter form. `patient_encounter.js:10-15` configures four editable columns: `drug_code`, `drug_name`, `dosage`, `period`. **There is no dialog and no drug-search screen.** |
| **Entity changed** | `Patient Encounter` (draft, `docstatus = 0`) with `Drug Prescription` child rows |
| **Status change** | None — no status field exists on either |
| **Financial consequence** | **None** |

### Stage 2 — Encounter submission — *the billing trigger*

| | |
|---|---|
| **Who** | `Physician` (the only role holding `submit`) |
| **Event** | `docstatus 0 → 1` fires `PatientEncounter.on_submit` (`patient_encounter.py:23-27`) |
| **Records created** | One **`Healthcare Service Order`** per drug row (`patient_encounter.py:138-166`), plus — for insured patients — one submitted **`Healthcare Insurance Claim`** per order (`healthcare_service_order.py:11-12` → `utils.py:1068-1099`) |
| **Status change** | HSO created at `Draft`, or `Waiting` if an insurance claim is pending |
| **Financial consequence** | **The drug becomes billable.** No ledger entry yet, but the item now appears in the billable-services list. For insured patients a **price is frozen** onto the claim. |

**[Confirmed]** `patient_encounter.py:138-166`:

```python
def create_healthcare_service_order(encounter):
	if encounter.drug_prescription:
		for drug in encounter.drug_prescription:
			medication = frappe.get_doc('Medication', drug.drug_code)
			args={
				'order_date': encounter.get_value('encounter_date'),
				'ordered_by': encounter.get_value('practitioner'),
				'order_group': encounter.name,
				'patient': encounter.get_value('patient'),
				'order_doctype': 'Medication',
				'order': medication.name,
				'quantity': drug.get_quantity(),
				...
				'company':encounter.company,
				'insurance_subscription' : encounter.insurance_subscription if encounter.insurance_subscription else ''
				}
			make_healthcare_service_order(args)
```

### Stage 3 — Fulfilment

| | |
|---|---|
| **Outpatient** | **DOES NOT EXIST.** No dispensing document, no stock movement, no status change, no screen. The patient takes the printed prescription elsewhere. |
| **Inpatient** | Optional and manual — see stages 3a/3b |

**[Confirmed]** The prescription print format (`erpnext/healthcare/print_format/encounter_print/encounter_print.json`) emits exactly four columns per drug — `drug_name`, `dosage`, `period`, `comment` — and **carries no price of any kind**.

### Stage 3a — Inpatient scheduling (optional)

| | |
|---|---|
| **Who** | Any user who can see the encounter and holds `Inpatient Medication Order` create rights (**`System Manager`** only, per the JSON) |
| **Trigger** | A manual **"Create → Inpatient Medication Order"** button, shown only when `drug_prescription && inpatient_record && inpatient_status === "Admitted"` (`patient_encounter.js:75-83`) |
| **What happens** | `make_ip_medication_order` (`patient_encounter.py:40-75`) expands each drug into **one child row per (date × dosage strength)** — a per-dose administration schedule |
| **Status** | On submit: `Pending` → `In Process` → `Completed`, derived from `completed_orders` vs `total_orders` |
| **Financial consequence** | **None.** The doctype has no price, rate, amount or `invoiced` field. |

### Stage 3b — Inpatient administration (optional)

| | |
|---|---|
| **Who** | In principle a nurse; **in practice only `Administrator`** — see §11 |
| **Trigger** | User creates an `Inpatient Medication Entry`, clicks **"Get Pending Medication Orders"**, then submits |
| **Selection** | `IMO.docstatus = 1 AND IMO.company = <company> AND IMOE.is_completed = 0` (`inpatient_medication_entry.py:189-224`) |
| **What happens on submit** | `on_submit` (`inpatient_medication_entry.py:47-57`): if `update_stock`, create a **`Material Issue` Stock Entry**; then flip `is_completed = 1` on each consumed order line |
| **Financial consequence** | **A cost, never a charge.** Stock is relieved and an expense is recognised (perpetual inventory only). No invoice line, no `invoiced` flag, no insurance claim. |

### Stage 4 — Invoicing

| | |
|---|---|
| **Who** | `Accounts User` or `Accounts Manager` — **not** a clinical role |
| **Trigger** | Manual. Someone opens a draft Sales Invoice and clicks **"Get Items From → Healthcare Services"** (or the rival **"Prescriptions"** button) |
| **Entity changed** | `Sales Invoice` gains items; on submit, `Healthcare Service Order.invoiced = 1` |
| **Financial consequence** | **The ledger entry.** `Dr Debtors / Cr Income` |

**[Confirmed]** There is **no automation** for medication invoicing. `Healthcare Settings.automate_appointment_invoicing` exists but applies only to `Patient Appointment` (`patient_appointment.py`), never to drugs. **[Not Found]** — `grep -n "drug\|medication" erpnext/healthcare/doctype/healthcare_settings/healthcare_settings.json` returns nothing; there is no drug-billing setting at all.

### Stage 5 — Payment

Standard ERPNext. Either a POS payment row on the invoice itself (`is_pos = 1`) or a separate `Payment Entry` allocated against the invoice.

### What the flow is *not*

| Assumed step | Reality |
|---|---|
| "Prescription submitted" | **The Patient Encounter** is submitted; the prescription is a child row with no state of its own |
| "Medication ordered" | Happens automatically and invisibly on encounter submit |
| "Medication approved" | **No approval exists.** No workflow, no approver role, no status transition (`grep -rn "Workflow" erpnext/healthcare/` → 0) |
| "Medication dispensed" | **Does not exist for outpatients.** For inpatients it is *administration*, and it has no billing effect |
| "Medication completed" | HSO `status` has a `Completed` value that **nothing ever sets for a medication** |
| "Medication returned" | **Does not exist** — see §7 |

---

## 4. The billing trigger, traced to the line

### 4.1 The two paths

**[Confirmed]** A prescribed drug can reach a Sales Invoice by two mutually unaware routes.

| | **Path A — Healthcare Service Order** | **Path B — Prescriptions dialog** |
|---|---|---|
| Origin | Automatic, on `Patient Encounter.on_submit` | Manual, per encounter |
| Collector | `get_healthcare_service_orders_to_invoice` (`utils.py:389-419`) | `get_drugs_to_invoice` (`utils.py:702-727`) |
| UI button | "Get Items From → **Healthcare Services**" (`sales_invoice.js:878-880`) | "Get Items From → **Prescriptions**" (`sales_invoice.js:881-883`) |
| Server assembly | `SalesInvoice.set_healthcare_services` (`sales_invoice.py:1295-1342`) | **None — pure client-side JS** (`sales_invoice.js:1256-1265`) |
| `reference_dt` / `reference_dn` | `'Healthcare Service Order'` / HSO name | **Not set** |
| Billability gate | `Medication.is_billable` | **None** |
| Rate | Insurance claim rate, else live Item Price | Live Item Price only |
| Quantity | `HSO.quantity` (always `get_quantity()`) | `1`, unless `Item.stock_uom == 'Nos'` |
| Insurance aware | Yes | No |
| Writes billing state back | Yes — `HSO.invoiced = 1` | **Nothing, anywhere** |
| Double-billing protection | `validate_invoiced_on_submit` | **None** |

### 4.2 Path A in full — the real trigger

**Step 1 — the billable unit is created.** `patient_encounter.py:23-27` → `create_healthcare_service_order` → `make_healthcare_service_order` (`utils.py:1056-1066`):

```python
@frappe.whitelist()
def make_healthcare_service_order(args):
	healthcare_service_order = frappe.new_doc('Healthcare Service Order')
	for key in args:
		if key == 'order_date':        healthcare_service_order.set(key, getdate(args[key]))
		elif key == 'expected_date':   healthcare_service_order.set(key, getdate(args[key]))
		else:                          healthcare_service_order.set(key, args[key] if args[key] else '')
	healthcare_service_order.save(ignore_permissions=True)
```

> **[Confirmed] Security note.** This function is `@frappe.whitelist()`, accepts a **free-form `args` dict** written straight onto a new document in a loop, and saves with `ignore_permissions=True`. **[Inference]** — basis: `Document.set(key, value)` accepts any fieldname, so a caller can supply `invoiced`, `quantity`, `billing_item` or `patient` directly. Any authenticated user can therefore create an arbitrary Healthcare Service Order without holding create permission on it.

**Step 2 — the collector.** `utils.py:389-419`, wired into the master aggregator at `utils.py:34`:

```python
def get_healthcare_service_orders_to_invoice(patient, company):
	service_order_to_invoice = []
	service_orders = frappe.get_list('Healthcare Service Order', fields='*',
		filters={'patient': patient.name, 'company': company, 'invoiced': False})
	for service_order in service_orders:
		item, is_billable = frappe.get_cached_value(
			service_order.order_doctype, service_order.order, ['item', 'is_billable'])
		if is_billable:
			if service_order.insurance_claim:
				if service_order.claim_status == 'Approved':
					coverage, discount, rate = frappe.get_cached_value('Healthcare Insurance Claim',
						service_order.insurance_claim, ['coverage', 'discount', 'price_list_rate'])
					service_order_to_invoice.append({
						'reference_type': 'Healthcare Service Order',
						'reference_name': service_order.name,
						'service': item, 'rate': rate,
						'qty': service_order.quantity if service_order.quantity else 1,
						'discount_percentage':discount,
						'insurance_claim_coverage': coverage,
						'insurance_claim': service_order.insurance_claim})
			else:
				service_order_to_invoice.append({
					'reference_type': 'Healthcare Service Order',
					'reference_name': service_order.name,
					'service': item,
					'qty': service_order.quantity if service_order.quantity else 1})
	return service_order_to_invoice
```

**[Confirmed]** For a medication order, `order_doctype == 'Medication'`, so `is_billable` is read from the **Medication master** and `item` is its generated Item. Three gates in sequence: `invoiced = 0`, `Medication.is_billable`, and — if insured — `claim_status == 'Approved'`.

> **[Confirmed] Silent revenue loss.** When `insurance_claim` is set but `claim_status` is anything other than `'Approved'` (i.e. `Pending`, or a rejection), **neither branch appends anything**. The drug vanishes from the billable list entirely, with no patient-payable fallback and no warning. There is no code path that re-bills it to the patient when a claim is declined.

> **[Confirmed] `is_billable` defaults to `0`.** A medication created without ticking that box will never be billed on this path — silently.

**Step 3 — the invoice line.** `SalesInvoice.set_healthcare_services` (`sales_invoice.py:1295-1342`) — note it **replaces the entire items table** (`self.set("items", [])`), resolves the rate as `checked_item['rate'] or item_details.price_list_rate`, and sets:

```python
	if checked_item['dt']: item_line.reference_dt = checked_item['dt']
	if checked_item['dn']: item_line.reference_dn = checked_item['dn']
```

`reference_dt` / `reference_dn` are **Custom Fields on `Sales Invoice Item`** installed by the Healthcare domain (`erpnext/domains/healthcare.py:52-60`), not core schema.

**Step 4 — submit, post, and write back.** `SalesInvoice.on_submit` (`sales_invoice.py:250-255`):

```python
	# Healthcare Service Invoice.
	domain_settings = frappe.get_doc('Domain Settings')
	active_domains = [d.domain for d in domain_settings.active_domains]
	if "Healthcare" in active_domains:
		manage_invoice_submit_cancel(self, "on_submit")
```

→ `manage_invoice_submit_cancel` (`utils.py:584-594`) → `set_invoiced` (`utils.py:597-633`) → for `reference_dt == 'Healthcare Service Order'`, `frappe.db.set_value(..., 'invoiced', True)`.

**[Confirmed]** Every write-back is a raw `frappe.db.set_value` — a direct SQL `UPDATE`. **[Inference]** — basis: Frappe's `Version` audit rows are produced by `Document.save`, which is bypassed here — **the billing state of a medication changes with no audit trail, no permission check and no validation.**

### 4.3 Path B — the untracked rival

**[Confirmed]** `utils.py:702-727`:

```python
@frappe.whitelist()
def get_drugs_to_invoice(encounter):
	encounter = frappe.get_doc('Patient Encounter', encounter)
	if encounter:
		patient = frappe.get_doc('Patient', encounter.patient)
		if patient:
			if patient.customer:
				items_to_invoice = []
				for drug_line in encounter.drug_prescription:
					if drug_line.drug_code:
						qty = 1
						if frappe.db.get_value('Item', drug_line.drug_code, 'stock_uom') == 'Nos':
							qty = drug_line.get_quantity()
						description = ''
						if drug_line.dosage and drug_line.period:
							description = _('{0} for {1}').format(drug_line.dosage, drug_line.period)
						items_to_invoice.append({
							'drug_code': drug_line.drug_code,
							'quantity': qty,
							'description': description})
				return items_to_invoice
			else:
				validate_customer_created(patient)
```

**[Confirmed]** The returned shape has **no `reference_type`, no `reference_name`, no `rate`, no `income_account`** — unlike every other collector in the file. The client-side handler (`sales_invoice.js:1256-1265`) sets only `item_code` and `qty`.

**[Confirmed]** Consequences, each independently verified:

1. **No filters.** No `invoiced` filter, no `docstatus` filter in the function, no company filter, no `is_billable` check. (The only `docstatus: 1` constraint is a client-side link-query filter at `sales_invoice.js:1164-1172`.)
2. **No write-back is even possible.** `manage_invoice_submit_cancel` short-circuits at `if item.get('reference_dt') and item.get('reference_dn')` — both are empty. And `Drug Prescription` has no `invoiced` field to write to anyway.
3. **Unlimited re-billing.** The same encounter can be pulled onto invoice after invoice, indefinitely, with no warning.
4. **It stays visible after Path A has already billed the drug**, because it reads the encounter's child table directly and knows nothing about `Healthcare Service Order.invoiced`.

**[Confirmed]** `get_drugs_to_invoice` has exactly one consumer repo-wide — the Sales Invoice client script (`sales_invoice.js:882`, `:1155`, `:1189`). **[Not Found]** No Python caller exists anywhere; no Delivery Note, Stock Entry, Material Request or POS code calls it.

### 4.4 The trigger, stated precisely

> **A medication becomes billable when the Patient Encounter carrying it is submitted, provided `Medication.is_billable = 1` — and, if the patient is insured, provided the auto-created insurance claim is `Approved`.**
>
> The *billable* event is the doctor's order. The *financial* event — the ledger entry — happens later and manually, when an accounts user pulls the resulting Healthcare Service Order onto a Sales Invoice and submits it.
>
> **Dispensing is not part of the chain at any point.**

---

## 5. Partial dispensing

**Verdict: NOT SUPPORTED financially. Partial *administration* is supported clinically for inpatients only, with zero financial consequence.**

Taking the example — 10 tablets prescribed, 6 given:

| Question | Answer | Evidence |
|---|---|---|
| Is the patient charged for 10 or 6? | **10** — or whatever `get_quantity()` returned at prescribing time. The billed quantity is frozen onto `Healthcare Service Order.quantity` when the encounter is submitted and is never revisited. | `patient_encounter.py:155`, `utils.py:407,417` |
| Is the prescription partially completed? | **The concept does not exist for outpatients.** For inpatients, `Inpatient Medication Order.status` becomes `In Process` when `completed_orders < total_orders`. | `inpatient_medication_order.py:43-58` |
| Is there a remaining balance/quantity? | **Clinically yes for inpatients** (`is_completed = 0` rows remain pending). **Financially no** — billing state is a single boolean. | `inpatient_medication_entry_detail`, `healthcare_service_order.json` |
| Is another transaction created later? | **No.** Once `HSO.invoiced = 1`, the order leaves the billable pool permanently. | `utils.py:394` |
| How is inventory affected? | Outpatient: not at all. Inpatient: each `Inpatient Medication Entry` issues stock for the doses it processes — genuinely incremental, per dose. | `inpatient_medication_entry.py:154-180` |
| How is billing affected? | **Not at all.** No inpatient medication document has any financial field. | §2.5 |

**[Confirmed]** The inpatient chain does support fine-grained partial fulfilment: `Inpatient Medication Entry` pulls whatever pending doses match its filters, flips only those to `is_completed = 1`, and issues stock only for those. `IMO.completed_orders` tracks progress. **[Confirmed]** But none of it touches money — see §8.

**[Confirmed]** The billing side is a **single boolean on a whole order**. `Healthcare Service Order.invoiced` cannot express "6 of 10 billed". There is no partially-invoiced state, no billed-quantity counter, and no residual.

---

## 6. Cancellation

### 6.1 Prescription cancelled before invoicing

**[Confirmed]** `PatientEncounter.on_cancel` (`patient_encounter.py:29-34`):

```python
def on_cancel(self):
	if self.appointment:
		frappe.db.set_value('Patient Appointment', self.appointment, 'status', 'Open')
	if self.inpatient_record and self.drug_prescription:
		delete_ip_medication_order(self)
```

> **[Confirmed] The Healthcare Service Orders are not touched.** Cancelling the encounter does **not** delete, revoke, or flag the drug orders it created. They keep `invoiced = 0` and remain in the billable pool indefinitely. The HSO `status` field has a `Revoked` option that nothing ever sets.
>
> **Consequence: a cancelled prescription is still billable.** A patient can be invoiced for medication from an encounter that was cancelled.

**[Confirmed]** `delete_ip_medication_order` (`patient_encounter.py:103-106`) does the opposite — it **hard-deletes** the Inpatient Medication Order with `force=1`, even when submitted:

```python
def delete_ip_medication_order(encounter):
	record = frappe.db.exists('Inpatient Medication Order', {'patient_encounter': encounter.name})
	if record:
		frappe.delete_doc('Inpatient Medication Order', record, force=1)
```

**[Inference]** — basis: `against_imoe` on the entry detail is a plain `Data` field, not a Link, so no referential check fires. Any `Inpatient Medication Entry` that already consumed those order lines is left pointing at rows that no longer exist, and the Stock Entries it produced are untouched.

### 6.2 Prescription cancelled after invoicing

**[Confirmed]** Nothing prevents it. `PatientEncounter.on_cancel` performs no billing check. There is no equivalent of the appointment's `cancel_appointment` logic (which at least looks for the invoice). The Sales Invoice, its GL entries and the `HSO.invoiced = 1` flag all stand.

### 6.3 Individual medication item cancelled

**[Confirmed] NOT SUPPORTED.** There is no per-line cancellation. `Drug Prescription` has no status field; `Healthcare Service Order` has a `Revoked` status that no code writes. Removing a drug row from a submitted encounter is impossible — child tables of a submitted document are immutable unless `allow_on_submit` is set, and **[Confirmed]** no `Drug Prescription` field carries `allow_on_submit`.

### 6.4 Sales Invoice cancelled

**[Confirmed]** `sales_invoice.py:337-342` fires `manage_invoice_submit_cancel(self, "on_cancel")` → `set_invoiced(item, 'on_cancel', ...)` → `invoiced = False`. The ledger is reversed by the standard mechanism (`make_reverse_gl_entries` — rows flagged `is_cancelled = 1` and side-swapped mirrors inserted). The medication returns to the billable pool.

> **[Confirmed] No ownership check.** `set_invoiced` receives `ref_invoice` and **discards it** (`utils.py:597`, the parameter is never referenced in the body). Cancelling *any* invoice that references an HSO clears the flag, even if a different, still-standing invoice was the one that billed it.

### 6.5 Financial consequences summarised

| Scenario | Charge removed? | Invoice voided? | Refund? | Reversal? | Prevented? |
|---|---|---|---|---|---|
| Encounter cancelled before invoicing | n/a | n/a | n/a | n/a | **No — and the order stays billable** |
| Encounter cancelled after invoicing | **No** | No | No | No | **No** |
| Individual drug cancelled | — | — | — | — | **Not possible** |
| Sales Invoice cancelled | Yes (`invoiced → 0`) | Yes | No | **Yes** — reverse GL entries | No |
| Credit note attempted | — | — | — | — | **Yes — blocked, see §7** |

---

## 7. Medication returns

**Verdict: NOT SUPPORTED. And the generic ERPNext return mechanism appears to be actively blocked for medication lines.**

**[Confirmed]** There is no return, restock, or reversal concept anywhere in the medication domain:

```
grep -rni "return" erpnext/healthcare/doctype/medication/ erpnext/healthcare/doctype/drug_prescription/  → nothing relevant
```

No "Medication Return" doctype, no restock action, no `returned_qty` field.

**Why a return would be meaningless anyway.** **[Confirmed]** Outpatient medications are non-stock Items (`is_stock_item: 0`), so there is no inventory position to restore. A drug was never *removed* from stock when sold, so it cannot be *returned* to stock.

**The generic path is blocked.** ERPNext's standard return is a Sales Invoice with `is_return = 1` (a credit note), built by `make_return_doc` (`erpnext/controllers/sales_and_purchase_return.py:234`) via `get_mapped_doc`. **[Confirmed]** the healthcare custom fields `reference_dt` and `reference_dn` are declared **without `no_copy`** (`erpnext/domains/healthcare.py:52-60`). **[Inference]** — basis: Frappe's `get_mapped_doc` copies same-named fields that are not marked `no_copy`, so those references are carried into the credit note's items.

The credit note is then submitted, and `sales_invoice.py:250-255` runs `manage_invoice_submit_cancel(self, "on_submit")` — with **no `is_return` exclusion** (verified by reading the surrounding block). That reaches `validate_invoiced_on_submit` (`utils.py:635-646`):

```python
	is_invoiced = frappe.db.get_value(item.reference_dt, item.reference_dn, 'invoiced')
	if is_invoiced:
		frappe.throw(_('The item referenced by {0} - {1} is already invoiced').format(
			item.reference_dt, item.reference_dn))
```

**[Inference — high confidence, basis stated above]** Submitting a credit note against a medication invoice throws *"The item referenced by Healthcare Service Order - HSO-xxxx is already invoiced"*, because the original invoice still stands and the flag is still `1`. **Credit notes are therefore unavailable in exactly the situation that calls for one.** The only remaining correction mechanism is full cancellation of the original invoice (§6.4).

**[Confirmed]** The healthcare "Get Items From" buttons are themselves hidden on returns — `sales_invoice.js:877` gates on `!frm.doc.is_return` — so healthcare lines cannot be added to a credit note deliberately either.

**Inpatient administration reversal.** **[Confirmed]** The one genuine reversal in the domain is stock-only: `InpatientMedicationEntry.on_cancel` (`inpatient_medication_entry.py:72-74`) cancels the linked Stock Entries and flips `is_completed` back to `0`, decrementing `completed_orders`. It has no financial counterpart because the forward path had none.

---

## 8. Inventory ↔ accounting relationship

### 8.1 The short answer

> **No. Dispensing is not the event that connects inventory movement to patient billing — because the two are never connected at all.**

**[Confirmed]** The system contains exactly one medication inventory movement (the inpatient `Material Issue`) and exactly one medication revenue path (the Healthcare Service Order → Sales Invoice). **Nothing links them.** There is no foreign key, no flag, no report, and no reconciliation.

### 8.2 What the outpatient path does to inventory

**Nothing.** **[Confirmed]** `Medication` Items are `is_stock_item: 0`. Selling a non-stock item produces no Stock Ledger Entry and no cost-of-goods-sold posting. Outpatient drug revenue has **zero recorded cost** — gross margin is structurally 100%.

### 8.3 What the inpatient path does to inventory

**[Confirmed]** `inpatient_medication_entry.py:154-180`:

```python
def make_stock_entry(self):
	stock_entry = frappe.new_doc('Stock Entry')
	stock_entry.purpose = 'Material Issue'
	stock_entry.set_stock_entry_type()
	stock_entry.from_warehouse = self.warehouse
	stock_entry.company = self.company
	stock_entry.inpatient_medication_entry = self.name
	cost_center = frappe.get_cached_value('Company',  self.company,  'cost_center')
	expense_account = get_account(None, 'expense_account', 'Healthcare Settings', self.company)

	for entry in self.medication_orders:
		se_child = stock_entry.append('items')
		se_child.item_code = entry.drug_code
		se_child.uom = frappe.db.get_value('Item', entry.drug_code, 'stock_uom')
		se_child.qty = flt(entry.dosage)
		se_child.conversion_factor = 1
		se_child.cost_center = cost_center
		se_child.expense_account = expense_account
		se_child.patient = entry.patient
		se_child.inpatient_medication_entry_child = entry.name

	stock_entry.submit()
	return stock_entry.name
```

Observations, each **[Confirmed]**:

- `purpose = 'Material Issue'` — an issue to expense, not a sale. Target warehouse is structurally impossible (`StockEntry.validate_warehouse` nulls `t_warehouse` for Material Issue).
- **`se_child.qty = flt(entry.dosage)`** — the *dosage strength number* is used literally as stock quantity, with `conversion_factor = 1`. A "500 mg" dose issues **500 units** of the item's stock UOM. There is no mg→tablet conversion anywhere in the path.
- `basic_rate` is never set — valuation is left to the stock engine (`set_rate_for_outgoing_items` → `get_incoming_rate`), i.e. moving-average or FIFO.
- The Stock Entry line **is stamped with the patient** (`se_child.patient`) — the only patient-level cost attribution in the entire medication domain. **[Confirmed]** and **nothing reads it**: `grep -rn "inpatient_medication_entry_child"` returns only the field definition, the write, and a test.

> **[Confirmed] The expense account resolves to `None`.** `get_account(None, 'expense_account', 'Healthcare Settings', company)` (`healthcare_settings.py:83-90`) reads a `Party Account` child row with `parentfield='expense_account'` on Healthcare Settings — but **`Healthcare Settings` has no `expense_account` table**. `grep -n "expense_account" healthcare_settings.json` → no matches; the only Party Account tables there are `income_account` and `receivable_account`. **[Inference]** — basis: `check_expense_account` (`stock_controller.py:246-250`) throws on an empty expense account before any GL row is written, and the fork's own test explicitly sets `Company.stock_adjustment_account` first (`test_inpatient_medication_entry.py:133-136`). The configuration this code reads from does not exist.

### 8.4 The blocking contradiction

**[Confirmed]** Two facts collide:

1. `create_item_from_medication` sets `is_stock_item: 0` (`medication.py:65`).
2. `StockLedgerEntry.validate_item` (`erpnext/stock/doctype/stock_ledger_entry/stock_ledger_entry.py:79-90`):

```python
	if item_det.is_stock_item != 1:
		frappe.throw(_("Item {0} must be a stock Item").format(self.item_code))
```

**[Inference — high confidence]** — basis: `StockLedgerEntry.validate` calls `validate_item()` (line 32), and Stock Entry submission creates SLEs. Submitting an `Inpatient Medication Entry` for a drug provisioned through the `Medication` master therefore **throws "Item X must be a stock Item"** unless someone has manually edited that Item to make it stockable. The inpatient dispensing path does not work against its own domain's data as provisioned.

Corroborating **[Confirmed]** evidence: the manual "Add Medication Orders" dialog filters `{'is_stock_item': 1}` (`inpatient_medication_order.js:36`), which would exclude every `Medication`-generated Item — while the encounter mapper (`patient_encounter.py:51`) inserts them with no such filter.

### 8.5 The accounting entry that does exist

**[Confirmed]** Posting is gated on a company switch. `StockController.make_gl_entries` (`erpnext/controllers/stock_controller.py:31-46`):

```python
	if cint(erpnext.is_perpetual_inventory_enabled(self.company)):
		warehouse_account = get_warehouse_account_map(self.company)
		if self.docstatus==1:
			if not gl_entries:
				gl_entries = self.get_gl_entries(warehouse_account)
			make_gl_entries(gl_entries, from_repost=from_repost)
```

**[Confirmed]** With `Company.enable_perpetual_inventory = 0`, the medication issue produces Stock Ledger Entries and **zero GL entries** — no cost reaches the P&L at all.

With it enabled, per item row, where `V = qty × valuation_rate`:

| | Account | Dr | Cr |
|---|---|---|---|
| | Expense / Stock Adjustment account | **V** | |
| | Warehouse account (Stock In Hand) | | **V** |

Cost centre = `Company.cost_center`. **[Confirmed]** There is no debit to Debtors and no credit to Income anywhere in this transaction.

### 8.6 The contrast that proves the omission is not inevitable

**[Confirmed]** `Clinical Procedure` and `Lab Test` in the *same module* do connect consumption to billing:

| | Clinical Procedure | Inpatient Medication Entry |
|---|---|---|
| Issues stock (`Material Issue`) | Yes (`clinical_procedure.py:289-306`) | Yes (`inpatient_medication_entry.py:154-180`) |
| **Looks up a selling price** | **Yes** — `get_item_details` against the selling Price List, per line (`clinical_procedure.py:92-106`) | **No** |
| **Stores a money field** | **Yes** — `consumable_total_amount`, `consumption_details` | **No such field exists** |
| **Opt-in billing flag** | **Yes** — `invoice_separately_as_consumables` | **No equivalent** |
| **Reaches a Sales Invoice** | **Yes** — `get_clinical_procedures_to_invoice` emits a line with `rate = consumable_total_amount` (`utils.py:246-262`) | **Never** |
| **Double-bill guard** | `consumption_invoiced` flag | No flag exists |
| **Blocks discharge if unbilled** | Yes (`inpatient_record.py:216`) | **No** |
| Patient stamped on the stock line | No | **Yes** |

**[Confirmed]** `ClinicalProcedure.complete_procedure` (`clinical_procedure.py:81-130`) creates the Stock Entry **and** prices the consumables in the same method — stock relief and patient charge are two coupled outputs of one completion event. `InpatientMedicationEntry.on_submit` performs only the first half and has no second half at all.

> The final irony, **[Confirmed]**: the medication path is the only one that stamps the patient onto the stock line. It has the *better cost-attribution data* and *no revenue to attribute it against*.

### 8.7 Discharge does not notice unbilled medication

**[Confirmed]** `inpatient_record.py:210-223`:

```python
	docs = ["Patient Appointment", "Patient Encounter", "Lab Test", "Clinical Procedure"]
	for doc in docs:
		doc_name_list = get_unbilled_inpatient_docs(doc, inpatient_record)
		...
def get_unbilled_inpatient_docs(doc, inpatient_record):
	return frappe.db.get_list(doc, filters = {'patient': inpatient_record.patient,
		'inpatient_record': inpatient_record.name, 'docstatus': 1, 'invoiced': 0})
```

**[Confirmed]** Neither medication doctype is in that whitelist, and neither could be — the query filters on an `invoiced` field that they do not have. **A patient can be discharged having consumed a full course of stock-relieved, unbilled medication, and the unbilled-services gate will not notice**, even with `allow_discharge_despite_unbilled_services = 0`.

---

## 9. Pricing

### 9.1 Where the price comes from

**[Confirmed]** The chain is: `Medication.rate` (Float) → `Item Price.price_list_rate` → resolved live at invoicing.

`medication.py:75-82`:

```python
def make_item_price(item, item_price):
	price_list_name = frappe.db.get_value('Price List', {'selling': 1})
	frappe.get_doc({
		'doctype': 'Item Price',
		'price_list': price_list_name,
		'item_code': item,
		'price_list_rate': item_price
	}).insert(ignore_permissions=True, ignore_mandatory=True)
```

**[Confirmed]** The price list is chosen by `frappe.db.get_value('Price List', {'selling': 1})` — **no ordering, no `enabled` filter, no currency or company filter**. Whichever selling price list the database returns first wins.

**[Confirmed]** `make_item_price` is called **unconditionally**, even when `is_billable = 0` or `rate` is empty. Contrast `Lab Test Template`, which guards with `if doc.is_billable and doc.lab_test_rate != 0.0` (`lab_test_template.py:112`).

**[Confirmed]** Updates run only when the hidden `change_in_item` dirty flag is set (`medication.py:29-48`), and read the Item Price by `item_code` **only**, not by price list:

```python
		if self.rate:
			item_price = frappe.get_doc('Item Price', {'item_code': self.item})
			item_price.price_list_rate = self.rate
			item_price.save()
```

**[Inference]** — basis: `frappe.get_doc` with a filter dict raises `DoesNotExistError` when nothing matches — editing a Medication whose Item Price row was deleted throws. And with multiple Item Prices, an arbitrary one is updated.

**[Confirmed]** `Medication` never writes `Item.standard_rate` (contrast `lab_test_template.py:66`). The price lives solely in `Item Price`.

### 9.2 Is the price fixed? Stored on the medication? Copied into billing records?

| Question | Answer |
|---|---|
| Fixed price? | **No** — it is a price-list rate, resolvable per price list |
| Stored on the medication? | **Yes**, as `Medication.rate`, but that is a *source* value pushed to Item Price; billing never reads it directly |
| Copied into the prescription? | **No.** `Drug Prescription` has no price field, and `create_healthcare_service_order` copies no monetary value (`patient_encounter.py:141-165`) |
| Copied into the order? | **No.** `Healthcare Service Order` has `billing_item` and `quantity` but no rate |
| Copied into the invoice? | **Yes** — `Sales Invoice Item.rate` is the historical record |
| Can prices change? | **Yes**, freely, by editing `Medication.rate` or the Item Price directly |
| Do historical charges preserve the old price? | **Yes for invoices** (the rate is stored on the submitted invoice line). **No for anything before invoicing** — an unbilled prescription is re-priced at whatever the price list says on the day it is finally invoiced, which may be months later. |

> **[Confirmed] The cash path has no price snapshot.** Between prescribing and invoicing, the only stored quantity is `HSO.quantity`; the rate is fetched live. Two patients prescribed the same drug on the same day can be billed different amounts if the price list changed in between.

### 9.3 The one exception — insurance freezes the price

**[Confirmed]** `create_insurance_claim` (`utils.py:1068-1099`), called from `HealthcareServiceOrder.after_insert`, snapshots the commercial terms **at prescribing time**:

```python
	insurance_claim.quantity = qty
	insurance_claim.service_item = billing_item
	insurance_claim.discount = insurance_details.discount
	insurance_claim.price_list_rate = price_list_rate
	insurance_claim.amount = float(price_list_rate) * float(qty)
	if insurance_claim.discount and float(insurance_claim.discount) > 0:
		insurance_claim.discount_amount = float(insurance_claim.price_list_rate) * float(insurance_claim.discount) * 0.01
		insurance_claim.amount = float(price_list_rate - insurance_claim.discount_amount) * float(qty)
	insurance_claim.coverage = insurance_details.coverage
	insurance_claim.coverage_amount = float(insurance_claim.amount) * 0.01 * float(insurance_claim.coverage)
	insurance_claim.save(ignore_permissions=True)
	insurance_claim.submit()
```

**[Confirmed]** The insurance price list cascade is three-tier (`utils.py:1101-1117`): `Healthcare Insurance Coverage Plan.price_list` → `Healthcare Insurance Contract.default_price_list` → `Selling Settings.selling_price_list`.

**[Confirmed]** Medications are first-class insurable services. `Healthcare Service Insurance Coverage.healthcare_service` options include `Medication` explicitly, and `coverage_based_on` allows `Service / Item / Item Group / Medical Code` — so a drug can be covered four ways, resolved in that order (`healthcare_service_insurance_coverage.py:45-80`).

### 9.4 Discounts, taxes, patient-specific pricing, quantity × rate

| Concept | Status |
|---|---|
| **Discounts** | **PARTIAL.** Only via the insurance claim's `discount` percentage, applied in `set_healthcare_services` (`sales_invoice.py`) as `discount_amount = rate × discount_percentage × 0.01`, then `rate = rate − discount_amount` — **mutating the rate itself**. No cash discount mechanism for drugs. |
| **Taxes** | **INHERITED.** Standard ERPNext Sales Taxes and Charges apply at invoice level. Nothing medication-specific. |
| **Insurance** | **IMPLEMENTED** — see above. Coverage percentage produces `insurance_claim_amount` and splits patient-payable vs insurer-payable via the custom fields `total_insurance_claim_amount` / `patient_payable_amount` on Sales Invoice. |
| **Patient-specific pricing** | **NOT IMPLEMENTED for drugs directly.** Achievable only through the generic ERPNext Price List / Pricing Rule machinery, or via a coverage plan's price list. |
| **Quantity × unit price** | `amount = rate × qty` is hard-assigned in `set_healthcare_services`. `qty` comes from `HSO.quantity` (Path A) or the `stock_uom == 'Nos'` rule (Path B). |

> **[Confirmed] The two paths can price the same prescription differently.** Path A always uses `get_quantity()`; Path B uses `1` unless the stock UOM is literally `'Nos'`. Since `create_item_from_medication` takes the UOM from `Medication.stock_uom`, a drug configured in "Tablet" or "Strip" bills **quantity 1** through the Prescriptions dialog and the full computed quantity through Healthcare Services.

---

## 10. Invoice / charge structure

### 10.1 The real structure

**[Confirmed]** There is **no `Charge` entity**. The chain is:

```
Medication (master)
    │  is_billable, rate
    ▼
Healthcare Service Order          ← the closest thing to a "charge", but it holds no money
    │  billing_item, quantity, invoiced
    │  reference_dt / reference_dn (custom fields on the invoice line)
    ▼
Sales Invoice Item                ← where money first appears: item_code, qty, rate, amount
    │
    ▼
Sales Invoice                     ← the billing transaction (grand_total, outstanding_amount, status)
    │
    ├──► GL Entry (n rows)        ← the accounting record
    │
    ├──► Payment Entry ──► Payment Entry Reference ──► GL Entry
    │
    └──► (Sales Invoice with is_return = 1)  ← credit note; blocked for medications, §7
```

**[Confirmed]** Missing entirely: `Charge`, `Billing Transaction`, `Account Receivable` as a document (receivables are derived from GL Entry balances), `Refund` as a document, `Adjustment` as a document.

### 10.2 The custom-field bridge

**[Confirmed]** `erpnext/domains/healthcare.py` installs, as Custom Fields:

| DocType | Fields |
|---|---|
| `Sales Invoice` | `patient`, `patient_name`, `ref_practitioner`, `total_insurance_claim_amount`, `patient_payable_amount` |
| `Sales Invoice Item` | `reference_dt`, `reference_dn`, `insurance_claim_coverage`, `insurance_claim_amount`, `insurance_claim` |
| `Stock Entry` | `inpatient_medication_entry` |
| `Stock Entry Detail` | `patient`, `inpatient_medication_entry_child` |
| `Payment Entry` | `patient`, `patient_name`, `inpatient_record` |
| `Delivery Note` | `patient`, `patient_name`, `emergency_patient_record`, `inpatient_record` |

**[Confirmed]** `Delivery Note` carries patient fields, but **nothing in the medication path ever creates one**. The only healthcare Delivery Note producer is `emergency_patient_record.py:107-128`, driven by an arbitrary dialog payload, not by prescriptions. **[Confirmed]** There are **no Delivery Note Item custom fields**, so a delivery line could never carry a healthcare reference even if one were created.

### 10.3 The ledger result

**[Confirmed]** A submitted medication Sales Invoice posts:

| Dr | Cr | Amount |
|---|---|---|
| Receivable account (`get_receivable_account(company)`), party = the patient's Customer | | `grand_total` |
| | Income account per line | `base_net_amount` |

**[Confirmed]** Income account resolution (`healthcare_settings.py`): Party Account on the practitioner → Party Account on Healthcare Settings → `Company.default_income_account`. **[Confirmed]** For a medication line arriving via `set_healthcare_services`, `income_account` is only set when the collector supplied it — and `get_healthcare_service_orders_to_invoice` **does not supply one**, so drug revenue falls to the invoice-level default rather than a per-practitioner or per-drug account.

With `is_pos = 1` and a payment row, `make_pos_gl_entries` adds `Dr Mode-of-Payment account / Cr Receivable`, netting the receivable to zero.

---

## 11. Roles and permissions

### 11.1 The roles that exist

**[Confirmed]** Enumerated from every `permissions` array across the healthcare doctypes, and corroborated by `erpnext/domains/healthcare.py:20-27`:

| Role | Appears on |
|---|---|
| System Manager | 48 doctypes |
| Healthcare Administrator | 43 |
| Physician | 40 |
| Nursing User | 21 |
| Laboratory User | 11 |
| Accounts Manager | 4 |
| Accounts User | 2 |
| LabTest Approver | 1 |

> **[Confirmed] There is no Pharmacist role.** `grep -rniE "pharmacist"` across the repository (excluding the Indian HSN customs data file) returns **zero hits**. `grep -rln '"doctype": "Role"'` returns **zero** — no role fixtures exist at all; the roles above come into existence only as a side effect of doctype installation. **[Inference]** — basis: Frappe auto-creates a Role record when a docperm references an unknown role name during schema sync.

**[Confirmed]** The asymmetry with the laboratory is stark: the lab has **two** dedicated roles (`Laboratory User` for execution, `LabTest Approver` for sign-off), its own workspace cards, its own settings switches, and a `Lab Test` doctype with a full submit/cancel lifecycle. The pharmacy has none of that.

### 11.2 Permission matrix

**[Confirmed]** read directly from each doctype's `permissions` array:

| DocType | Role | Create | Read | Write | Submit | Cancel | Amend | Delete |
|---|---|---|---|---|---|---|---|---|
| **Patient Encounter** | Physician | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Drug Prescription** | *(empty — inherits parent)* | | | | | | | |
| **Medication** | System Manager | ✔ | ✔ | ✔ | — | — | — | ✔ |
| | Healthcare Administrator | ✔ | ✔ | ✔ | — | — | — | ✔ |
| **Healthcare Service Order** | System Manager | ✔ | ✔ | ✔ | — | — | — | ✔ |
| | Physician | ✔ | ✔ | ✔ | — | — | — | — |
| | Healthcare Administrator | ✔ | ✔ | ✔ | — | — | — | ✔ |
| | Nursing User | — | ✔ | — | — | — | — | — |
| **Inpatient Medication Order** | System Manager | ✔ | ✔ | ✔ | **—** | **—** | **—** | ✔ |
| **Inpatient Medication Entry** | System Manager | ✔ | ✔ | ✔ | **—** | **—** | **—** | ✔ |
| **Stock Entry** | Stock User / Stock Manager / Manufacturing User / Manufacturing Manager | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Sales Invoice** | Accounts Manager | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| | Accounts User | ✔ | ✔ | ✔ | ✔ | **—** | ✔ | **—** |
| **Payment Entry** | Accounts User / Accounts Manager | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

> **[Confirmed] `Patient Encounter` grants permission to exactly one role — `Physician`.** Not System Manager, not Healthcare Administrator, not Nursing User. A nurse cannot even *read* an encounter.

> **[Confirmed] Both inpatient medication doctypes are submittable, yet no role in either JSON has `submit`, `cancel` or `amend`.** Verified programmatically — the arrays contain a single System Manager entry with create/read/write/delete only. **[Inference]** — basis: Frappe's permission check short-circuits for the `Administrator` user — **only `Administrator` can submit an Inpatient Medication Order or Entry as shipped.** Since submitting the IME is what issues the stock, the entire inpatient dispensing path is unusable without a manual permission patch.

**[Confirmed]** `make_stock_entry` (`inpatient_medication_entry.py:179`) calls `stock_entry.submit()` **without** `ignore_permissions` — so whoever submits the medication entry must personally hold Stock Entry submit rights too.

### 11.3 Who can do what, by role

| Role | Create | Modify | Approve | Dispense | Cancel | Financial actions |
|---|---|---|---|---|---|---|
| **Doctor (Physician)** | Encounter + prescriptions; Healthcare Service Orders | Own drafts | **Nothing — no approval exists** | Nothing | The encounter (which silently leaves its billable orders alive) | **Triggers the billable event by submitting the encounter** |
| **Nurse (Nursing User)** | Nothing medication-related | Nothing | Nothing | **Nothing** — cannot submit an Inpatient Medication Entry | Nothing | None |
| **Pharmacist** | **Role does not exist** | | | | | |
| **Receptionist** | No dedicated role in this fork | | | | | |
| **Accountant (Accounts User/Manager)** | Sales Invoice, Payment Entry | Invoices | — | — | Invoices (Manager only) | **Creates the actual financial and accounting records** |
| **Healthcare Administrator** | Medication masters, Healthcare Service Orders | Masters, incl. **prices** | — | — | — | **Sets `rate` and `is_billable` — controls what is billable and at what price** |
| **Admin (System Manager / Administrator)** | Everything | Everything | — | Only `Administrator` can actually submit inpatient medication entries | Everything | Everything |
| **Patient** | — | Via the `prescription` web form, `allow_edit: 1` on a Drug Prescription table — see below | — | — | — | None |

> **[Confirmed] Permission bypasses on the medication path.** `grep -rn "ignore_permissions" erpnext/healthcare/` → 84 hits. The medication-relevant ones:
>
> | Site | Bypasses |
> |---|---|
> | `utils.py:1066` — `make_healthcare_service_order` | HSO create permission, on a **whitelisted method with free-form args** |
> | `medication.py:37,70,82` | Item and Item Price create/write |
> | `medication.py:90` | `rename_doc('Item', …)` — renames an Item without Item permission |
> | `utils.py:1096` | Insurance claim create, then `submit()` |
> | `emergency_patient_record.py:125` | Delivery Note create **and submit** — moves stock, from a whitelisted method taking caller-supplied `items` JSON |

> **[Inference] A design smell on the patient portal.** `erpnext/healthcare/web_form/prescription/prescription.json` has `doc_type: Patient Encounter`, `login_required: 1`, `allow_edit: 1`, and exposes the full `drug_prescription` child table. `prescription.py` sets `read_only = 1` only on the *list* context, and `has_website_permission` is ownership-based, not field-based. Basis for the inference: the JSON grants edit rights on a table of drugs to the logged-in patient, and the Python guard checks *whose* record it is, not *which fields* may change.

### 11.4 Approval

**[Confirmed] There is no approval step for medications.**

```
grep -rn "Workflow" erpnext/healthcare/   → 0 hits
find . -type d -name "workflow*"          → only .github/workflows (CI)
```

The only state machines are plain `status` Select fields, and the medication one is never advanced (§2.4).

---

## 12. Database-level analysis

Frappe stores each DocType in a table named `tab<DocType>`. Every table has `name` (varchar primary key), `owner`, `creation`, `modified`, `modified_by`, `docstatus`, `idx`; child tables add `parent`, `parenttype`, `parentfield`.

**[Inference]** throughout this section — basis: Frappe's ORM conventions, observable in the SQL written by hand in `utils.py` (e.g. `` `tabInpatient Medication Order` ``) but not verifiable against a schema file, since the framework is absent.

### `tabMedication`
| Aspect | Detail |
|---|---|
| Purpose | Drug master; owns an `Item` and an `Item Price` |
| PK | `name` = `medication_name` (`autoname: format:{medication_name}`) |
| FKs | `medication_class` → Medication Class; `item` → Item; `item_group` → Item Group; `stock_uom`/`strength_uom` → UOM; `healthcare_service_order_category`, `patient_care_type`, `staff_role` |
| Financial fields | **`is_billable`** (Check, default 0), **`rate`** (Float) |
| Status fields | `disabled`, `change_in_item` |
| Audit | Standard Frappe columns only |

### `tabDrug Prescription` (child)
| Aspect | Detail |
|---|---|
| Purpose | One prescribed drug on a Patient Encounter |
| PK | `name` (hash) |
| Parent | `parent` → `tabPatient Encounter`, `parentfield = 'drug_prescription'` |
| FKs | `drug_code` → **Medication**; `dosage` → Prescription Dosage; `period` → Prescription Duration; `dosage_form` → Dosage Form; `replaces`, `priority` → Healthcare Service Order / Priority |
| Quantity fields | `quantity` (Int, **dead**) |
| **Financial fields** | **NONE** |
| **Status fields** | **NONE** |
| Audit | Standard columns; `docstatus` mirrors the parent |

### `tabHealthcare Service Order`
| Aspect | Detail |
|---|---|
| Purpose | **The billable unit for a medication** |
| PK | `name` (naming series) |
| FKs | `order_doctype` + `order` (polymorphic → Medication); `billing_item` → Item; `patient`, `company`, `ordered_by`, `insurance_claim`; `order_group` (Data holding the encounter name — **not a Link**) |
| **Financial fields** | **`invoiced`** (Check) — the entire billing state |
| Quantity | `quantity` (Float) |
| Price | **None** |
| Status | `status` (Select, 9 values, never advanced for drugs); `claim_status` |
| Audit | Standard columns; **not submittable**, so `docstatus` is always 0 |

### `tabInpatient Medication Order` / `…Order Entry`
| Aspect | Detail |
|---|---|
| Purpose | Per-dose administration schedule |
| PK | `name` (`HLC-IMO-.YYYY.-`) |
| FKs | `patient_encounter`, `patient`, `inpatient_record`, `practitioner`, `company` |
| Quantity | `total_orders`, `completed_orders` (Float, derived) |
| Status | `status` (derived from docstatus + completion counts) |
| **Financial fields** | **NONE** |
| Child | `drug` → **Item**, `dosage` (Float), `date`, `time`, `is_completed` (Check) |

### `tabInpatient Medication Entry` / `…Entry Detail`
| Aspect | Detail |
|---|---|
| Purpose | Records administration; issues stock |
| PK | `name` (`HLC-IME-.YYYY.-`) |
| FKs | `company`, `warehouse` → Warehouse, plus filter links |
| Status | `status` — **dead column, never written** |
| **Financial fields** | **NONE** |
| Child FKs | `drug_code` → Item; `against_imo` → IMO (Link); `against_imoe` → **Data, not a Link** (no referential integrity) |

### `tabSales Invoice` / `tabSales Invoice Item`
| Aspect | Detail |
|---|---|
| Purpose | The billing transaction; the first place money is recorded |
| Financial fields | `grand_total`, `outstanding_amount`, `total_insurance_claim_amount`*, `patient_payable_amount`* |
| Item financial fields | `rate`, `qty`, `amount`, `discount_percentage`, `discount_amount`, `income_account`, `insurance_claim_amount`* |
| Healthcare FKs | `reference_dt`* / `reference_dn`* (Dynamic Link → Healthcare Service Order), `patient`*, `insurance_claim`* |
| Status | `status`, `docstatus` |

`*` = Custom Field injected by `erpnext/domains/healthcare.py`.

### `tabGL Entry`
The single append-only-style ledger. `account`, `party_type`, `party`, `debit`, `credit`, `voucher_type`, `voucher_no`, `posting_date`, `is_cancelled`, `against_voucher_type`, `against_voucher`. Balances are derived by aggregation; there is no balance column anywhere.

### How they connect

```
tabMedication.name  ─────────────►  tabItem.item_code  ────►  tabItem Price.item_code
       ▲                                    ▲
       │ drug_code                          │ billing_item
       │                                    │
tabDrug Prescription.parent ──► tabPatient Encounter.name
                                            │
                                            │ order_group (Data, weak)
                                            ▼
                              tabHealthcare Service Order.name
                                            │
                                            │ reference_dn (Dynamic Link)
                                            ▼
                              tabSales Invoice Item.parent ──► tabSales Invoice.name
                                                                        │ voucher_no
                                                                        ▼
                                                                  tabGL Entry
```

> **[Confirmed] Two of the most important links in that chain are weak.** `Healthcare Service Order.order_group` holds the encounter name as plain **Data**, and `Inpatient Medication Entry Detail.against_imoe` holds an order-entry name as plain **Data**. Neither is a Link, so neither is protected by referential integrity — which is precisely why `delete_ip_medication_order`'s `force=1` deletion can leave dangling references (§6.1).

---

## 13. API / service-level analysis

**[Confirmed]** All whitelisted endpoints and internal services on the medication path:

| Function | File:line | Whitelisted | Called by | Receives | Changes | Creates financial record? | Changes inventory? |
|---|---|---|---|---|---|---|---|
| `create_healthcare_service_order` | `patient_encounter.py:138` | No | `PatientEncounter.on_submit` | the encounter | Creates one HSO per drug | **No — but makes the drug billable** | No |
| `make_healthcare_service_order` | `utils.py:1056` | **Yes** | above; any HTTP caller | free-form `args` dict | Inserts an HSO with `ignore_permissions` | No | No |
| `create_insurance_claim` | `utils.py:1068` | No | `HealthcareServiceOrder.after_insert` | doc, service doctype/name, qty, billing item | Creates + **submits** an insurance claim | **Yes — freezes the price** | No |
| `get_insurance_price_list_rate` | `utils.py:1101` | No | above | plan, company, item | — (read) | No | No |
| `get_healthcare_services_to_invoice` | `utils.py:20` | **Yes** | `sales_invoice.js` | patient, company | — (read) | No | No |
| `get_healthcare_service_orders_to_invoice` | `utils.py:389` | No | above | patient, company | — (read) | No | No |
| `get_drugs_to_invoice` | `utils.py:702` | **Yes** | `sales_invoice.js:1189` only | encounter name | — (read) | No | No |
| `SalesInvoice.set_healthcare_services` | `sales_invoice.py:1295` | Doc method | `sales_invoice.js:1246` | checked rows | **Replaces the invoice items table** | Builds the lines | No |
| `manage_invoice_submit_cancel` | `utils.py:584` | No | `SalesInvoice.on_submit` / `on_cancel` | doc, method | Routes to `set_invoiced` | **Yes (the invoice already posted)** | No |
| `set_invoiced` | `utils.py:597` | No | above | invoice item, method | `HSO.invoiced` via raw SQL | No | No |
| `validate_invoiced_on_submit` | `utils.py:635` | No | `set_invoiced` (submit only) | invoice item | Throws if already invoiced | No | No |
| `make_ip_medication_order` | `patient_encounter.py:40` | **Yes** | encounter "Create" button | encounter name | Builds an IMO (per-dose expansion) | No | No |
| `delete_ip_medication_order` | `patient_encounter.py:103` | No | `PatientEncounter.on_cancel` | encounter | **Force-deletes the IMO** | No | No |
| `IMO.add_order_entries` | `inpatient_medication_order.py:60` | Doc method | IMO dialog | drug/dosage/period/form | Appends dated dose rows | No | No |
| `IME.get_medication_orders` | `inpatient_medication_entry.py:~` | Doc method | "Get Pending Medication Orders" | filters | Fills the child table | No | No |
| `IME.make_stock_entry` | `inpatient_medication_entry.py:154` | No | `IME.on_submit` | — | **Creates + submits a Material Issue Stock Entry** | **Cost only** | **YES** |
| `IME.cancel_stock_entries` | `inpatient_medication_entry.py:182` | No | `IME.on_cancel` | — | Cancels the Stock Entries | Reverses the cost | **YES** |
| `make_difference_stock_entry` | `inpatient_medication_entry.py:291` | **Yes** | "Make Stock Entry" button | IME name | Returns an **unsaved** Material Transfer | No | Not until saved |
| `create_item_from_medication` | `medication.py:50` | No | `Medication.after_insert` | medication | Creates Item + Item Price | **Sets the price** | No |
| `change_item_code_from_medication` | `medication.py:83` | **Yes** | Medication form button | item code, doc | Renames the Item | No | No |

**[Confirmed]** No endpoint anywhere creates a Sales Invoice from a medication automatically. Invoicing is always a human action in the Sales Invoice UI.

---

## 14. Frontend workflow

### 14.1 Screens that exist

| Purpose | Screen | Verdict |
|---|---|---|
| Creating prescriptions | Inline grid on the **Patient Encounter** form (`patient_encounter.js:10-15`) | **IMPLEMENTED** — four columns, no dialog, no drug search |
| Viewing prescriptions | Patient Encounter form; the **Patient History** page; the `/prescription` web form | **IMPLEMENTED** |
| Approving prescriptions | — | **NOT IMPLEMENTED** |
| Dispensing medications | — | **NOT IMPLEMENTED** (outpatient). Inpatient Medication Entry is the nearest analogue |
| Completing prescriptions | — | **NOT IMPLEMENTED** |
| Billing | Two dialogs on **Sales Invoice** | **IMPLEMENTED** |
| Viewing invoices | Standard Sales Invoice | Inherited |
| Payments | Standard Payment Entry / POS | Inherited |
| Returns / cancellations | Standard cancel; credit note **blocked** for medication lines (§7) | **PARTIAL** |

### 14.2 The prescribing screen

**[Confirmed]** `patient_encounter.js:10-15`:

```js
frm.get_field('drug_prescription').grid.editable_fields = [
    {fieldname: 'drug_code', columns: 2},
    {fieldname: 'drug_name', columns: 2},
    {fieldname: 'dosage', columns: 2},
    {fieldname: 'period', columns: 2}
];
```

**[Confirmed]** All custom buttons on Patient Encounter: Schedule Discharge, Schedule Admission, Refer Practitioner, View→Patient History, and Create→{Vital Signs, Medical Record, Clinical Procedure, **Inpatient Medication Order**}. **[Confirmed]** There is **no "Dispense", no "Create Delivery Note", and no "Create Sales Invoice"** button. A commented-out `is_stock_item` filter on `drug_code` sits at lines 91-97 — dead code.

**What the user does not see:** submitting the encounter silently creates a Healthcare Service Order per drug. There is no confirmation, no list, and no link surfaced on the form.

### 14.3 The billing dialogs

**[Confirmed]** `sales_invoice.js:873-885` adds two buttons under one group, gated on the Healthcare domain, `docstatus == 0`, not POS, not a return:

```js
frm.add_custom_button(__('Healthcare Services'), function() {
    get_healthcare_services_to_invoice(frm);
},"Get Items From");
frm.add_custom_button(__('Prescriptions'), function() {
    get_drugs_to_invoice(frm);
},"Get Items From");
```

| | "Healthcare Services" | "Prescriptions" |
|---|---|---|
| Inputs | Patient | Patient + Patient Encounter (`docstatus: 1`) |
| Columns shown | service / reference_name / reference_type | drug_code / quantity / description |
| On "Add" | **Clears all items**, then calls the server method `set_healthcare_services` | **Clears all items**, then appends rows client-side |
| Medications appear? | **Yes** — as Healthcare Service Orders, if `Medication.is_billable` | **Yes** — always, unfiltered |

**[Confirmed]** Both handlers execute `frm.set_value("items", [])` (`sales_invoice.js:1086`) — **pulling healthcare items destroys any lines already on the invoice.**

**[Confirmed]** The drug branch of `add_to_item_line` (`sales_invoice.js:1256-1265`) sets only `item_code` and `qty` — no rate, no description, no reference. The rate then arrives through the ordinary ERPNext item-code fetch from the price list.

### 14.4 Navigation

**[Confirmed]** `erpnext/healthcare/workspace/healthcare/healthcare.json` — the v13 workspace — links to `Prescription Dosage`, `Prescription Duration` (under "Consultation Setup") and `Dosage Form` (misfiled under "Laboratory"). **It does not link to `Medication`, `Inpatient Medication Order`, `Inpatient Medication Entry`, or `Healthcare Service Order` at all.**

**[Inference]** — basis: Frappe v13 loads `workspace/`, superseding the v12 `desk_page/` format. The older `erpnext/healthcare/desk_page/healthcare/healthcare.json` still in the repo *does* carry an "Inpatient" card with both medication doctypes and an "Orders" card with Healthcare Service Order — so the richer navigation is likely dead, leaving the medication doctypes reachable only by search.

---

## 15. Financial event timeline

The actual sequence for an **outpatient** medication, the normal case:

| T | Business event | Database change | Inventory | Financial / accounting | User |
|---|---|---|---|---|---|
| **T0** | Doctor records drugs on an encounter | `tabDrug Prescription` rows inserted, `docstatus 0` | None | None | Physician |
| **T1** | **Encounter submitted** | Encounter `docstatus 0→1`; **one `Healthcare Service Order` per drug, `invoiced = 0`** | None | **The drug becomes billable.** No ledger entry. | Physician |
| **T1a** | *(insured only)* Claim created | `Healthcare Insurance Claim` inserted **and submitted**, freezing `price_list_rate`, `discount`, `coverage_amount` | None | **Price frozen.** Claim `Approved` or `Pending` | System (`ignore_permissions`) |
| **T2** | Patient collects the drug | **NOTHING IS RECORDED** | **None** | None | — |
| **T3** | Accounts user pulls "Healthcare Services" onto a draft invoice | `Sales Invoice Item` rows built with `reference_dt = 'Healthcare Service Order'`; existing items **wiped** | None | Draft only | Accounts User |
| **T4** | **Sales Invoice submitted** | Invoice `docstatus 0→1`; **`GL Entry` rows written**; `HSO.invoiced = 1` via raw SQL | None | **Dr Debtors / Cr Income.** Revenue recognised; receivable created | Accounts User |
| **T5** | Payment received | `Payment Entry` submitted (or POS row on the invoice) | None | **Dr Cash/Bank / Cr Debtors.** `outstanding_amount` reduced | Accounts User |
| **T6** | Inventory reduced | **NEVER HAPPENS** | **None** | No COGS ever recorded | — |

For an **inpatient** medication, a parallel and entirely separate timeline:

| T | Business event | Database change | Inventory | Financial | User |
|---|---|---|---|---|---|
| **T1′** | "Create → Inpatient Medication Order" | IMO + per-dose child rows; on submit status `Pending` | None | **None** | System Manager |
| **T2′** | Nurse records administration | `Inpatient Medication Entry` submitted; `is_completed = 1` per dose; `completed_orders` incremented | **Stock Entry (Material Issue)** → SLE, stock reduced | **Dr Expense / Cr Warehouse** — *only if* `Company.enable_perpetual_inventory` | Only `Administrator` can submit (§11) |
| **T3′** | Discharge | `Inpatient Record.status = 'Discharged'` | None | **Unbilled medication is not checked** | Healthcare Administrator |

> **[Confirmed] The two timelines never intersect.** Nothing reconciles what was administered (T2′) against what was billed (T4). A drug can be billed and never given, or given and never billed, and no flag, report or validation in the system will detect either.

---

## 16. Edge cases — supported / partial / not supported

| # | Edge case | Verdict | Evidence |
|---|---|---|---|
| 1 | **Cancelled prescriptions** | **PARTIALLY SUPPORTED — and unsafe.** The encounter can be cancelled, but its Healthcare Service Orders are untouched and remain billable. | `patient_encounter.py:29-34` |
| 2 | **Duplicate prescriptions** | **NOT PREVENTED.** No duplicate check on drug rows. Two encounters prescribing the same drug produce two independent billable orders. | No validation in `drug_prescription.py` |
| 3 | **Partial quantities** | **NOT SUPPORTED financially.** Billing state is one boolean per order. Partial *administration* is supported for inpatients only, with no financial effect. | §5 |
| 4 | **Out-of-stock medication** | **PARTIALLY SUPPORTED.** Outpatient: impossible — drugs are non-stock, stock is never checked, and a drug with zero inventory bills normally. Inpatient: `check_stock_qty` throws a shortage table unless `allow_negative_stock`. | `inpatient_medication_entry.py:126-152` |
| 5 | **Price changes** | **SUPPORTED but unsnapshotted for cash.** Unbilled prescriptions re-price at the rate prevailing when the invoice is finally raised. Insurance claims freeze the price at prescribing time. | §9.2, §9.3 |
| 6 | **Failed payment** | **INHERITED.** Standard ERPNext — the invoice simply stays outstanding. Nothing medication-specific; no order is revoked. | — |
| 7 | **Refunds** | **NOT SUPPORTED for medications.** No refund document exists; the credit-note route appears blocked. | §7 |
| 8 | **Returns** | **NOT SUPPORTED.** No return concept, and non-stock items cannot be restocked. | §7 |
| 9 | **Deleted records** | **SUPPORTED, dangerously.** `delete_ip_medication_order` hard-deletes a submitted IMO with `force=1`, leaving `against_imoe` Data references dangling. | `patient_encounter.py:103-106` |
| 10 | **Reopened prescriptions** | **NOT SUPPORTED.** No reopen concept. Amending an encounter creates a new document, which on submit creates **another** set of billable orders. | `amended_from` semantics |
| 11 | **Expired prescriptions** | **NOT SUPPORTED.** No expiry, no validity window. `Prescription Duration` describes the *course length*, not prescription validity. An order stays billable forever. | `healthcare_service_order.json` |
| 12 | **Multiple medications in one prescription** | **SUPPORTED.** One `Drug Prescription` row and one Healthcare Service Order per drug; each is billed and flagged independently. | `patient_encounter.py:140` |
| 13 | **One medication in multiple prescriptions** | **SUPPORTED.** Each prescription produces its own order. No cross-checking, no duplicate-therapy warning. | ibid. |
| 14 | **Prescription modified after billing** | **PARTIALLY PREVENTED.** Submitted child rows are immutable (no `allow_on_submit`), but the encounter can be **cancelled** after billing with no check, and its invoice stands. | §6.2 |
| 15 | **Insurance claim not approved** | **UNSAFE.** A `Pending` or rejected claim removes the drug from the billable list entirely, with no patient-payable fallback and no warning. | `utils.py:399-411` |
| 16 | **Same drug billed via both dialogs** | **NOT PREVENTED.** The two paths are mutually unaware; the Prescriptions dialog remains available after the HSO is invoiced. | §4.1 |
| 17 | **Concurrent invoicing of one order** | **NOT PREVENTED.** `validate_invoiced_on_submit` reads, then `set_invoiced` writes, with no lock and no unique constraint. | `utils.py:635-646` |
| 18 | **`is_billable` unticked** | **SILENT.** The drug is never billed, with no warning anywhere. Default is `0`. | `medication.json` |
| 19 | **Medication renamed** | **BREAKS THE CHAIN.** `change_item_code_from_medication` renames only the Item; `get_drugs_to_invoice`'s `get_value('Item', drug_code, …)` then returns `None` and quantity silently falls back to 1. | `medication.py:83-92` |
| 20 | **Discharge with unbilled drugs** | **NOT DETECTED.** The unbilled-services gate checks four doctypes; neither medication doctype is among them. | `inpatient_record.py:210-223` |

---

## 17. Accounting interpretation

Translating the implementation into accounting language.

| Accounting concept | What represents it here | Status |
|---|---|---|
| **Billable event** | Submission of the `Patient Encounter` → creation of a `Healthcare Service Order` with `invoiced = 0`. This is an *order*, not a delivery. | **IMPLEMENTED** |
| **Revenue** | The income-account credit on a submitted `Sales Invoice`. Recognised at **invoicing**, which is decoupled from both prescribing and any delivery of goods. | **IMPLEMENTED** |
| **Inventory movement** | A `Material Issue` `Stock Entry` from the inpatient path only. Outpatient drugs never move stock. | **PARTIALLY IMPLEMENTED** |
| **Cost of goods sold** | **Does not exist for medications sold.** The inpatient issue debits an expense account, but it is not matched to any sale. Outpatient sales have no cost at all. | **NOT IMPLEMENTED** |
| **Money received** | `Payment Entry` (Dr Cash/Bank, Cr Debtors), or a POS payment row on the invoice. | **IMPLEMENTED** (inherited) |
| **Refund** | **No refund document exists.** The credit-note route appears blocked for healthcare-referenced lines. | **NOT IMPLEMENTED** |
| **Adjustment** | Only full cancellation of the Sales Invoice, which posts reversing GL rows. No partial adjustment, no write-off on the medication path. | **PARTIALLY IMPLEMENTED** |
| **Outstanding receivable** | `Sales Invoice.outstanding_amount`, and the derived balance of the receivable account in `GL Entry`. | **IMPLEMENTED** (inherited) |
| **Deferred revenue / unearned income** | **Not used.** Because revenue is recognised at invoicing and there is no delivery obligation modelled, the question never arises. | **NOT IMPLEMENTED** |

### Formal journal entries

**[Confirmed]** Formal double-entry **does exist** — but the healthcare module contains no accounting engine of its own. It never calls `make_gl_entries` and never creates a GL Entry. All double-entry consequences follow from the generic Sales Invoice, Payment Entry and Stock Entry controllers.

The three entries a medication can produce:

**1. Invoicing (the only medication revenue entry):**

| Dr | Cr | Amount |
|---|---|---|
| Receivable (party = patient's Customer) | | `grand_total` |
| | Income account | `base_net_amount` |

**2. Payment:**

| Dr | Cr | Amount |
|---|---|---|
| Cash / Bank (Mode of Payment account) | | `paid_amount` |
| | Receivable (party = patient's Customer) | `paid_amount` |

**3. Inpatient administration — *only* if `Company.enable_perpetual_inventory` is on:**

| Dr | Cr | Amount |
|---|---|---|
| Expense / Stock Adjustment account | | `qty × valuation_rate` |
| | Warehouse account (Stock In Hand) | `qty × valuation_rate` |

> **[Confirmed] Entry 3 is never matched to entry 1.** They arise from different documents, for different patients potentially, at different times, with no linking field. **The gross margin on medication cannot be computed from this ledger**: outpatient drug revenue has no cost, and inpatient drug cost has no revenue.

---

## 18. Critical finding

> ### Exactly what event causes the patient to be financially charged for a medication in this system, and why?

**The event is the submission of the Patient Encounter — the doctor's act of prescribing.** Not approval, not dispensing, not delivery, not completion.

**Why:** because `PatientEncounter.on_submit` calls `create_healthcare_service_order`, which materialises a `Healthcare Service Order` per drug carrying `invoiced = 0`. That flag is the sole criterion the billing collector uses. From that instant the drug is in the billable pool, and it will remain there until someone invoices it — regardless of whether the patient ever received the medicine, and regardless of whether the encounter is subsequently cancelled.

The ledger entry itself is created later, by a separate human action in a separate module: an accounts user pulling the order onto a Sales Invoice and submitting it.

### The complete chain

```
CLINICAL EVENT
   Doctor types drug rows into the Drug Prescription grid and submits the encounter
   erpnext/healthcare/doctype/patient_encounter/patient_encounter.js:10-15
        ↓
BUSINESS EVENT                                   ← THE BILLING TRIGGER
   PatientEncounter.on_submit  (docstatus 0 → 1)
   patient_encounter.py:23-27
        ↓
SERVICE / FUNCTION
   create_healthcare_service_order(encounter)     patient_encounter.py:138-166
      └─ make_healthcare_service_order(args)      utils.py:1056-1066
            frappe.new_doc('Healthcare Service Order')
              .order_doctype = 'Medication'
              .order         = <Medication>
              .billing_item  = <Item>            (fetched from Medication.item)
              .quantity      = drug.get_quantity()
              .invoiced      = 0                 ← THE BILLABLE STATE
            .save(ignore_permissions=True)
        ↓
   [if insured] HealthcareServiceOrder.after_insert → create_insurance_claim()
                utils.py:1068-1099 — freezes price_list_rate, discount, coverage;
                claim is SUBMITTED; claim_status = Approved | Pending
        ↓
BILLING EVENT   (manual, later, by an accounts user)
   get_healthcare_services_to_invoice(patient, company)          utils.py:20-37
      └─ get_healthcare_service_orders_to_invoice(...)           utils.py:389-419
            filters: invoiced = 0
            gate:    Medication.is_billable        ← default 0
            gate:    claim_status == 'Approved'    ← if insured
            emits:   {reference_type: 'Healthcare Service Order',
                      reference_name: <HSO>, service: <Item>, qty: <quantity>}
        ↓
   SalesInvoice.set_healthcare_services(checked_values)          sales_invoice.py:1295-1342
            rate = checked_item['rate'] or item_details.price_list_rate
            item_line.reference_dt = 'Healthcare Service Order'
            item_line.reference_dn = <HSO>
        ↓
INVOICE / CHARGE
   Sales Invoice submitted  (docstatus 0 → 1)
   Sales Invoice Item: item_code, qty, rate, amount
        ↓
ACCOUNTING RECORD
   make_gl_entries()  →  GL Entry rows
        Dr  Receivable (party = Patient.customer)   grand_total
        Cr  Income account                          base_net_amount
        ↓
   manage_invoice_submit_cancel(doc, 'on_submit')               sales_invoice.py:250-255
      └─ set_invoiced(item, 'on_submit', doc.name)              utils.py:597-633
            validate_invoiced_on_submit(item)   ← throws if already invoiced
            frappe.db.set_value('Healthcare Service Order', <HSO>, 'invoiced', True)
            (raw SQL — no validation, no permission check, no audit row)
        ↓
PAYMENT
   Payment Entry submitted, or POS payment row on the invoice
        Dr  Cash / Bank        paid_amount
        Cr  Receivable         paid_amount
```

### What is conspicuously absent from that chain

| Missing link | Consequence |
|---|---|
| **Dispensing** | Revenue is recognised for goods that may never have been handed over |
| **Inventory relief** | Medication Items are `is_stock_item: 0` — the sale moves no stock |
| **Cost of goods sold** | Medication revenue carries no matched cost; margin is unmeasurable |
| **A charge entity** | Billing state is one boolean, so partial billing, refunds and audit are all impossible |
| **Cancellation propagation** | Cancelling the encounter leaves its billable orders alive |
| **Reconciliation** | Nothing compares what was administered against what was billed |

---

## 19. Recommendations for the clinic system

Derived **only** from what was found in the reference project. Your system (`C:\Users\el awael\Clinic-System`) already has `apps/billing` (ServiceItem, Invoice, InvoiceItem, Payment, CreditNote, Refund, PatientDeposit, FeeValidity) and `apps/accounting` (Account, JournalEntry, JournalLine, FiscalYear, Period) — a stronger financial base than the reference project's healthcare module. Your `apps/medications` holds clinical reference data only, and `medical_records.Prescription` / `PrescriptionItem` carry `status` and `quantity` but no price, no dispensing and no billing link.

### A. Strongly recommended concepts

| # | Adopt | Why — from the reference project |
|---|---|---|
| **A1** | **Separate the *order* from the *prescription line*.** The reference project's `Healthcare Service Order` is the one genuinely good idea in this domain: a uniform, billable order object created from any clinical document, with its own identity and billing state. | The prescription row itself (`Drug Prescription`) has no state, which is precisely why medications have no lifecycle. A separate order object gives you somewhere to put status, quantity, billing state and fulfilment — and it worked well enough that lab, radiology and procedures all share it. |
| **A2** | **Make the billable unit a first-class `Charge` with a state machine, not a boolean.** | `Healthcare Service Order.invoiced` is a single Check field. It cannot express partial billing, cannot name the invoice that billed it, cannot be audited, and cannot be made concurrency-safe. Every defect in §6, §7 and §16 traces back to that one design choice. Your `InvoiceItem` is close; add an explicit charge/order state (`ORDERED → FULFILLED → BILLED → PAID`, with `CANCELLED`/`VOIDED`). |
| **A3** | **Decide explicitly whether you dispense — and if you do, make dispensing the billable event.** | The reference project bills at *ordering* and has no dispensing at all. That is defensible for a clinic that only writes prescriptions to be filled elsewhere (which is what your `Prescription.pdf_file` suggests), but it must be a *decision*, not an accident. If your clinic hands out medicine, bill on dispensing — that is the only event that coincides with delivery, and it is the one that should also relieve inventory. |
| **A4** | **Snapshot the price onto the charge at the moment the charge is created.** | The reference project does this *only* on the insurance branch (`create_insurance_claim` freezes `price_list_rate`, `discount`, `coverage`), and *not* for cash patients — so an unbilled cash prescription silently re-prices whenever the price list changes. Copy the insurance branch's behaviour and apply it universally. |
| **A5** | **Propagate cancellation.** Cancelling the clinical document must revoke or cancel every charge it created. | `PatientEncounter.on_cancel` touches only the appointment status and the inpatient order — the Healthcare Service Orders survive with `invoiced = 0` and stay billable. A cancelled prescription that can still be invoiced is a direct revenue-integrity defect. |
| **A6** | **One collector per domain, one uniform charge shape.** The `{reference_type, reference_name, service, rate, qty}` contract is clean, even though the ten implementations behind it are inconsistent. | It gives the billing layer a single interface to every clinical source. Keep the contract; make the implementations uniform, which the reference project failed to do (3 of 10 filter on `docstatus`, 6 of 10 omit the rate). |
| **A7** | **Make "is this billable?" an explicit, validated property of the service master — and fail loudly when it is unset.** | `Medication.is_billable` defaults to `0`, so a drug is silently unbillable until someone ticks a box, with no warning anywhere. Equally, a missing `Item Price` bills the line at **zero** silently. Both are silent revenue losses. Validate at save time, as `Lab Test Template` does (`if is_billable and rate <= 0: throw`) and `Medication` does not. |
| **A8** | **Never write financial state with raw SQL.** | Every `invoiced` transition in the reference project is `frappe.db.set_value` — bypassing validation, permissions and the audit trail. You already have `apps/audit`; route all billing-state changes through the ORM so they are captured. |

### B. Optional concepts

| # | Consider | Why |
|---|---|---|
| **B1** | **A service master that owns its billing item and price** (`Medication` → `Item` → `Item Price`). | Useful if you ever need one catalogue for both clinical and commercial purposes. Your `billing.ServiceItem` already plays this role — consider linking `medications.Medication` to a `ServiceItem` rather than duplicating price data. |
| **B2** | **Per-dose administration scheduling** (`Inpatient Medication Order Entry`: one row per date × dose). | Genuinely good clinical modelling, and it gives real partial-fulfilment tracking. Only worth it if you have inpatients or day-care infusions. |
| **B3** | **Patient stamped on the inventory movement** (`Stock Entry Detail.patient`). | The reference project's best unused idea — per-patient cost attribution on the stock line. If you ever add inventory, do this from day one; retrofitting cost attribution is painful. |
| **B4** | **A three-tier price-list cascade for insurers** (Coverage Plan → Contract → default). | A clean way to model insurer-specific tariffs without duplicating the catalogue. Adopt only when you actually have multiple insurers with different rates. |
| **B5** | **Insurance coverage resolvable at several granularities** (service → item → item group → medical code, first match wins). | Flexible and genuinely useful, but it adds real complexity. Defer until insurance is a live requirement. |

### C. Concepts that should NOT be copied blindly

| # | Do not copy | Why |
|---|---|---|
| **C1** | **Boolean `invoiced` as billing state.** | The single most consequential mistake in this domain. See A2. |
| **C2** | **Two parallel billing paths for the same thing.** | The "Healthcare Services" and "Prescriptions" dialogs both bill drugs; one is stateful, one records nothing, and neither knows about the other. Unlimited silent double-billing is possible. Have exactly one path from clinical event to charge. |
| **C3** | **Billing at ordering while pretending goods are involved.** | Medications are sold as non-stock service Items, so revenue is booked for a physical product with no inventory relief and no COGS. If you sell goods, model them as goods. If you don't, don't imply you do. |
| **C4** | **`ignore_permissions=True` on whitelisted endpoints taking free-form field dicts.** | `make_healthcare_service_order` accepts an arbitrary `args` dict, writes each key onto a new document, and saves with permissions off — an authenticated user can set `invoiced`, `quantity` or `patient` directly. Never build this shape. |
| **C5** | **Submittable documents with no `submit` permission granted to any role.** | Both inpatient medication doctypes ship this way, making the dispensing path usable only by `Administrator`. Test your permission matrix against the actual workflow. |
| **C6** | **Deriving quantity from dosage strength without unit conversion.** | `se_child.qty = flt(entry.dosage)` issues 500 units for a "500 mg" dose. Model dose, dose unit, and dispensed pack quantity as separate, explicitly converted values. |
| **C7** | **Hard-delete with `force=1` on submitted documents.** | `delete_ip_medication_order` destroys a submitted order and leaves `Data`-typed references dangling. Use real foreign keys and soft-delete — your `SoftDeleteModel` already does this correctly. |
| **C8** | **Weak `Data` fields standing in for foreign keys.** | `HSO.order_group` and `IME Detail.against_imoe` hold document names as plain text, which is exactly why the force-delete above goes unnoticed. |
| **C9** | **Silently dropping a charge when an insurance claim is not approved.** | If the claim is `Pending`, the drug disappears from the billable list with no patient-payable fallback. Always keep the charge; change *who owes it*. |
| **C10** | **Letting the fulfilment status exist but never advancing it.** | `Healthcare Service Order.status` has nine values, including `Completed` and `Revoked`, and for medications **none of them is ever set**. A status field that nothing writes is worse than no field — it implies a lifecycle that does not exist. |

### D. Missing capabilities your clinic system may need

Absent from the reference project entirely. Each is a decision you must make deliberately, because there is no prior art here to copy.

| # | Missing capability | Why it matters |
|---|---|---|
| **D1** | **A dispensing record.** No document anywhere represents "this medicine was handed to this patient". | Without it you cannot bill on delivery, cannot reconcile stock against sales, cannot answer "did the patient actually get it?", and cannot support returns. If your clinic dispenses, this is the single most important thing to add. |
| **D2** | **A pharmacist role and a pharmacy queue.** No role, no screen, no worklist. | The reference project gave the laboratory two roles and a full workflow while giving pharmacy nothing. If dispensing is real work in your clinic, it needs an actor and a screen. |
| **D3** | **Medication returns and refunds.** No return concept; credit notes appear blocked for healthcare lines. | You already have `CreditNote` and `Refund` models — make sure a medication charge can actually reach them, and test that path explicitly. |
| **D4** | **Partial billing / residual quantity.** Billing is all-or-nothing per order. | Needed the moment you dispense less than prescribed. Model `quantity_ordered`, `quantity_dispensed`, `quantity_billed` separately. |
| **D5** | **Cost of goods sold matched to medication revenue.** | The reference ledger cannot compute drug margin at all. If medication is a revenue line for you, its cost must be recognised against it — otherwise your P&L overstates margin. |
| **D6** | **Prescription validity / expiry and refills.** No expiry, no refill count, no dispense-against-prescription limit. | Clinically and legally significant for controlled drugs, and commercially significant if a prescription can be filled more than once. |
| **D7** | **Stock awareness at prescribing time.** Outpatient stock is never checked; a drug with zero inventory bills normally. | Even a soft warning at prescribing time prevents charging for something you cannot supply. |
| **D8** | **Duplicate-therapy and interaction enforcement.** `Medication` declares `bypass_allergy_check`, `bypass_medication_class_interaction_check` and interaction tables — **but no Python enforces any of them** (`grep` over `*.py` returns nothing). | Your `check_allergy_interactions` in `apps/medications/services.py` already does more than the reference project. Keep it, and make sure it is enforced at prescribing, not merely advisory. |
| **D9** | **Reconciliation reporting.** Nothing compares administered vs billed; the only medication report has no financial column. | A "dispensed but unbilled" and "billed but not dispensed" report is the operational control that the reference project's design makes impossible. |
| **D10** | **Charge-level audit trail.** Billing state changes via raw SQL with no version rows. | You have `apps/audit`; make every charge transition auditable — who, when, which invoice, and why. |

---

## 20. Evidence index

Every load-bearing claim, with its source. All paths are relative to the reference repository root.

### The billing trigger
| Claim | Source |
|---|---|
| Encounter submit creates the billable orders | `erpnext/healthcare/doctype/patient_encounter/patient_encounter.py:23-27`, `:138-166` |
| Orders are inserted with permissions off, from free-form args | `erpnext/healthcare/utils.py:1056-1066` |
| The billing collector, and its three gates | `erpnext/healthcare/utils.py:389-419` |
| Wired into the master aggregator | `erpnext/healthcare/utils.py:20-37` (line 34) |
| Invoice lines assembled, references set | `erpnext/accounts/doctype/sales_invoice/sales_invoice.py:1295-1342` |
| Submit/cancel hooks into healthcare | `erpnext/accounts/doctype/sales_invoice/sales_invoice.py:250-255`, `:337-342` |
| Write-back router; no `Drug Prescription` branch | `erpnext/healthcare/utils.py:584-594`, `:597-633` |
| Duplicate-invoice guard | `erpnext/healthcare/utils.py:635-646` |

### The rival path
| Claim | Source |
|---|---|
| `get_drugs_to_invoice` — no filters, no references | `erpnext/healthcare/utils.py:702-727` |
| Its only consumer, and the client-side line builder | `erpnext/accounts/doctype/sales_invoice/sales_invoice.js:882`, `:1155`, `:1189`, `:1256-1265` |
| Both buttons declared side by side | `erpnext/accounts/doctype/sales_invoice/sales_invoice.js:873-885` |

### Data model
| Claim | Source |
|---|---|
| `Drug Prescription` has no `invoiced`, no status, nothing financial | `erpnext/healthcare/doctype/drug_prescription/drug_prescription.json` |
| Siblings do have `invoiced` + `*_created` | `lab_prescription.json`, `procedure_prescription.json` |
| `get_quantity()` and the dead duration multiplier | `erpnext/healthcare/doctype/drug_prescription/drug_prescription.py:10-34` |
| `Medication` schema; `is_billable` default 0 | `erpnext/healthcare/doctype/medication/medication.json` |
| Item created non-stock, non-purchasable | `erpnext/healthcare/doctype/medication/medication.py:50-73` |
| Item Price creation and resync | `erpnext/healthcare/doctype/medication/medication.py:29-48`, `:75-82` |
| Rename breaks the name identity | `erpnext/healthcare/doctype/medication/medication.py:83-92` |
| HSO controller is 28 lines, no fulfilment hook | `erpnext/healthcare/doctype/healthcare_service_order/healthcare_service_order.py` |

### Inventory and accounting
| Claim | Source |
|---|---|
| The only medication stock movement | `erpnext/healthcare/doctype/inpatient_medication_entry/inpatient_medication_entry.py:154-180` |
| Its cancellation | `…/inpatient_medication_entry.py:72-74`, `:182-186` |
| Pending-dose selection query | `…/inpatient_medication_entry.py:189-224` |
| Non-stock items cannot produce a stock ledger entry | `erpnext/stock/doctype/stock_ledger_entry/stock_ledger_entry.py:28-40`, `:79-90` |
| Perpetual-inventory gate and the GL pair | `erpnext/controllers/stock_controller.py:31-46`, `:66-134` |
| Expense account reads a non-existent table | `erpnext/healthcare/doctype/healthcare_settings/healthcare_settings.py:83-90` |
| The procedure contrast — stock **and** price in one method | `erpnext/healthcare/doctype/clinical_procedure/clinical_procedure.py:81-130`, `:289-306`; `erpnext/healthcare/utils.py:246-262` |
| Discharge ignores medication | `erpnext/healthcare/doctype/inpatient_record/inpatient_record.py:210-223` |

### Pricing and insurance
| Claim | Source |
|---|---|
| Insurance freezes the price at prescribing | `erpnext/healthcare/utils.py:1068-1099` |
| Three-tier insurer price-list cascade | `erpnext/healthcare/utils.py:1101-1117` |
| `Medication` is an insurable service type | `erpnext/healthcare/doctype/healthcare_service_insurance_coverage/healthcare_service_insurance_coverage.json` |

### UI, roles and integration
| Claim | Source |
|---|---|
| Prescription grid; no dispense button | `erpnext/healthcare/doctype/patient_encounter/patient_encounter.js:10-15`, `:29-83` |
| Inpatient order dialog filters `is_stock_item: 1` | `erpnext/healthcare/doctype/inpatient_medication_order/inpatient_medication_order.js:36` |
| Permission arrays (verified programmatically) | `patient_encounter.json`, `medication.json`, `healthcare_service_order.json`, `inpatient_medication_order.json`, `inpatient_medication_entry.json` |
| Custom-field bridge into accounts and stock | `erpnext/domains/healthcare.py:29-121` |
| Prescription print carries no price | `erpnext/healthcare/print_format/encounter_print/encounter_print.json` |
| Workspace omits every medication doctype | `erpnext/healthcare/workspace/healthcare/healthcare.json` |
| Return mapper; references lack `no_copy` | `erpnext/controllers/sales_and_purchase_return.py:234`, `:368-388`; `erpnext/domains/healthcare.py:52-60` |

### Searches proving absence
```
grep -rni "dispensed\|dispense"  erpnext/healthcare/                     → 0
grep -rniE "pharmacist"          (repo, minus hsn_code_data.json)        → 0
grep -rni "pharmacy"             (repo, minus erpnext/regional/)         → 0
grep -rn  "Workflow"             erpnext/healthcare/                     → 0
grep -rn  "refill"               erpnext/healthcare/                     → 0
grep -rln '"doctype": "Role"'    --include=*.json .                      → 0
grep -n   "drug\|medication"     …/healthcare_settings/healthcare_settings.json → 0
grep -n   "expense_account"      …/healthcare_settings/healthcare_settings.json → 0
grep -rni "patient"              erpnext/stock/doctype/delivery_note/    → 0
```

---

## Open questions / not verified

Stated honestly, so nothing here is mistaken for a verified fact.

1. **Frappe framework behaviour is not observable.** The `frappe` application is absent from the reference repository (`requirements.txt` lists it unpinned). Every claim about `get_mapped_doc` field copying, `frappe.db.set_value` with a `None` name, permission short-circuiting for `Administrator`, and `Version` audit rows is **[Inference]** with its basis stated at the point of use.
2. **The credit-note block (§7) was not executed.** It follows from three confirmed facts — `reference_dt`/`reference_dn` lack `no_copy`, `on_submit` has no `is_return` exclusion, and `validate_invoiced_on_submit` throws on a set flag — but the conclusion depends on Frappe's mapper copying custom fields. Rated high-confidence **[Inference]**, not **[Confirmed]**. It should be tested on a running instance before being relied upon.
3. **The `is_stock_item` blocking contradiction (§8.4)** likewise follows from confirmed code on both sides but was not run. A site that manually edits drug Items to be stockable would not hit it.
4. **`Emergency Patient Record`'s drug involvement** was traced only far enough to establish that its Delivery Note path is not prescription-driven. Its full billing behaviour is out of scope here.
5. **Pricing Rules, coupons and the generic ERPNext discount engine** were not traced against medication items. They are available in principle; whether any healthcare path exercises them was not established.
6. **Multi-company behaviour** was noted (every collector is company-scoped) but not tested for medications specifically.
7. **No automated test covers any medication billing path.** The only medication tests found are `test_inpatient_medication_order.py` and `test_inpatient_medication_entry.py`, which exercise scheduling and stock, not billing.
