# Phase 5 & 6 — Implementation Notes

## Phase 5 — Vital Signs Module

### Backend Architecture

#### `apps/vital_signs/` — New Django App

The vital signs system lives in its own isolated Django app rather than inside `medical_records`. This matters because `medical_records` had a `MedicalDataPermission` class and a `scope_to_user()` helper that both explicitly **block secretaries** — they were designed for sensitive clinical notes. Vital signs are routine observations that secretaries record daily, so they needed a fresh permission boundary.

**Model: `VitalSigns`** extends two abstract base classes:
- `SoftDeleteModel` — gives `is_deleted` flag and a custom `Manager` that filters deleted rows from normal queries, plus an `all_objects` manager for admin use
- `TimeStampedModel` — gives `created_at` and `updated_at` auto-fields

The fields split into two storage types intentionally:
- `DecimalField` for `temperature` (e.g. 37.2°C) and `weight` (e.g. 72.5 kg) — these are fractional measurements
- `PositiveSmallIntegerField` for everything else (BP, heart rate, SpO2, etc.) — whole numbers, smaller storage footprint, range-enforced with `MinValueValidator`/`MaxValueValidator`

`blood_glucose` is nullable/optional — not all visits require it.

`bmi` is a **`@property`**, never stored in the database. It computes as `weight / (height_in_meters)²` at read time. The reason: if a patient's height changes (typo correction), BMI recalculates automatically. Storing a derived value creates consistency risk.

Two database indexes:
- `(patient, -created_at)` — the most common query pattern is "all vitals for patient X, newest first"
- `appointment` — for joining to a specific visit

The `appointment` FK is nullable because vitals can be recorded outside of a scheduled appointment.

**Serializers:** Two separate classes — a split between read and write shapes.

`VitalSignsReadSerializer` is completely read-only. It adds `recorded_by_name` (a string from the related User) and `bmi` as a `SerializerMethodField` that calls the model property. Django REST Framework's `DecimalField` serializes to **JSON strings** by default (to preserve decimal precision without floating-point drift) — so `temperature` and `weight` arrive in the frontend as `"37.2"` and `"72.5"`. This is a DRF design choice you can't easily override globally.

`VitalSignsWriteSerializer` adds a cross-field `validate()` method that raises `ValidationError` if `bp_diastolic >= bp_systolic` (physiologically impossible), or if `height == 0` (would cause division-by-zero in BMI).

**Permissions: `VitalSignsPermission`** — custom class, not reusing anything from `medical_records`. Key rules:

- `has_permission` (list/create): PATIENT → read-only (no create); SECRETARY/MANAGER → full access; DOCTOR → full access
- `has_object_permission` (retrieve/update/delete): The 24-hour edit window is enforced here. For PATCH requests, if `record.created_at < now() - 24 hours` AND the user is not MANAGER, it raises `PermissionDenied` (HTTP 403). DELETE is manager-only.

The 24h check raises 403 rather than 400 because the *request is valid*, the *resource exists*, but the *user is not permitted* to act on it at this time — semantically a permission issue, not a validation issue.

**Views: `VitalSignsViewSet`** — the queryset scoping is inline, not delegated to a shared helper:

```python
# Pseudo-code of the inline scoping logic
MANAGER/SECRETARY → VitalSigns.objects.all()
PATIENT           → VitalSigns.objects.filter(patient__user=request.user)
DOCTOR            → VitalSigns.objects.filter(
                        patient__treating_doctors__doctor__user=request.user
                    ).distinct()
```

The `.distinct()` on the doctor query prevents duplicate rows when a patient has multiple `DoctorPatient` relationship rows for the same doctor.

`perform_create()` verifies `doctor_treats(user, patient)` before saving — a doctor can't record vitals for a patient outside their panel. It also auto-sets `recorded_by=request.user`.

`perform_destroy()` calls `instance.soft_delete()` — marks `is_deleted=True` rather than issuing a SQL `DELETE`.

---

### Frontend Architecture

#### `vitals.utils.ts` — Shared Threshold Logic

This utility centralizes all abnormal-value thresholds so the same logic drives both the form (live feedback as you type) and the history view (coloring old records). The thresholds:

| Field | Warning | Danger |
|-------|---------|--------|
| SpO2 | < 95 | < 90 |
| Heart Rate | < 60 or > 100 | < 40 or > 150 |
| BP Systolic | < 90 or > 140 | < 70 or > 180 |
| Temperature | < 36 or > 37.5 | < 35 or > 39 |
| BMI | > 25 | < 18.5 or > 30 |
| Glucose | > 140 | < 70 or > 200 |

`getVitalAlertLevel(field, value)` returns `'normal' | 'warning' | 'danger'`.
`vitalBadgeClass(level)` maps that to a BEM modifier: `''`, `'vitals-card__item--warning'`, `'vitals-card__item--danger'`.
`hasAbnormalVitals(record)` returns true if any field is non-normal — used to flag entire records in the history list.

#### `VitalSignsForm.tsx`

Props: `{ patientId, initial?, appointmentId?, onSuccess?, onCancel? }`. When `initial` is provided, the form pre-populates (edit mode); without it, it's create mode.

The form holds one flat `form` state object. BMI is **not** in state — it's computed via `useMemo` watching `form.weight` and `form.height`. This means it recalculates on every keystroke without being stored anywhere.

The field layout uses a 2-column CSS grid (`.vitals-form__row`) for paired fields: BP systolic/diastolic together, HR/temperature together, RR/SpO2 together, weight/height together. BMI has its own display-only box (`.vitals-form__bmi`). Notes is a full-width textarea.

On submit, it calls `vitalsApi.create()` or `vitalsApi.update()` and invalidates two query keys: `['vitals', patientId]` (the paginated history) and `['vitals', patientId, 'trend']` (the chart data).

The specific 403 handling: if the mutation errors with HTTP 403, instead of showing the generic error message, it shows `t('vitals.editWindowExpired')` — a user-friendly message explaining the 24h window has closed.

#### `VitalSignsCard.tsx`

Renders a single vital signs record. Internally has a `MetricTile` sub-component that takes `{ label, value, unit, field, rawValue }`. It calls `getVitalAlertLevel(field, rawValue)` to get the alert level and applies the corresponding BEM modifier class. The tile background stays neutral; only the value text color changes to warning (amber) or danger (red).

`parseFloat()` is called on `temperature` and `weight` before passing to the alert level function, since they arrive as strings from the API.

The meta row shows "Recorded by [name] on [date]". Edit/delete buttons are only rendered if `onEdit` and `onDelete` props are provided — the patient view passes neither.

#### `VitalSignsTrendChart.tsx`

Pure SVG, no charting library. The viewBox is `0 0 600 160` with `width: 100%` — so it scales responsively.

The metric selector (a `<Select>` component) lets the user pick which field to plot. Available metrics: `bp_systolic`, `heart_rate`, `oxygen_saturation`, `temperature`, `bmi`.

Data processing: the API returns records newest-first, so the chart reverses the array before plotting. Each data point is mapped to an `(x, y)` SVG coordinate based on min/max normalization within the dataset. The polyline color is determined by the *worst* alert level across all points in the current dataset.

Guard: if `data.length < 2`, it renders a text paragraph instead of trying to draw a meaningless single-point line.

#### `VitalSignsHistory.tsx`

Paginated query using `['vitals', patientId]`. Renders a `VitalSignsCard` per record. In staff mode (not `readOnly`), each card has Edit and Delete buttons. Delete triggers `useConfirm()` for a confirmation dialog before calling `vitalsApi.delete()`.

#### `PatientVitalSignsTab.tsx`

Gets `patientId` from `useAuth().user.patient_profile?.id`. The patient profile ID (the `PatientProfile.id` PK) is what the vitals API filters on — not the Django `User.id`. Renders `VitalSignsTrendChart` above `VitalSignsHistory` with `readOnly=true`.

#### `PatientRecordPage.tsx` — `VitalsSection`

An inline component defined inside `PatientRecordPage.tsx` (not its own file, following the pattern of other sections in that file). It renders above the medical records section whenever a patient is selected. It composes `VitalSignsForm` (for recording new vitals) + `VitalSignsTrendChart` + `VitalSignsHistory` (with staff permissions — edit/delete available).

---

## Phase 6 — Lab Orders System

### Backend Architecture

#### Models — Three New Classes in `medical_records/models.py`

Models are **appended** to the existing file, not in a new app. This keeps lab orders co-located with the other clinical data models (`MedicalRecord`, `Prescription`, etc.) and avoids cross-app FK complications.

**`LabOrder`** (SoftDeleteModel + TimeStampedModel):

The `order_number` field uses a custom generation strategy in `save()`:

```python
def _generate_order_number():
    year = timezone.now().year
    prefix = f"LAB-{year}-"
    with transaction.atomic():
        last = LabOrder.all_objects.filter(order_number__startswith=prefix)
                   .order_by("-order_number")
                   .values_list("order_number", flat=True)
                   .first()
        seq = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"
```

`transaction.atomic()` creates a savepoint. `all_objects` (the unfiltered manager) is used so soft-deleted orders still count in the sequence — you never want gaps in audit trails. The `unique=True` constraint on `order_number` is the final race guard: if two concurrent requests generate the same number, the second `INSERT` gets an `IntegrityError` which DRF turns into a 400 response.

Four nullable `DateTimeField`s track the lifecycle timestamps: `ordered_at`, `sample_collected_at`, `completed_at`, `reviewed_at`. These are set by the service functions, not the model.

Three composite indexes: `(patient, status)`, `(doctor, status)`, `(status, created_at)` — matching the most common query patterns in the viewset.

**`LabOrderItem`** and **`LabOrderResult`** are plain models — no `SoftDeleteModel`. The design decision: when a `LabOrder` is soft-deleted, its items and results become invisible (all queries go through `LabOrder`'s manager which filters `is_deleted=True`) but the rows remain in the database as an audit trail. This avoids cascading soft-delete complexity on child models.

`LabOrderResult` has a `FileField` using a custom `lab_order_result_path()` upload path function that namespaces files under `lab_orders/patient_{id}/{uuid}{ext}`. The UUID prevents filename collisions and path traversal.

#### `services/lab_orders.py` — State Machine

Five functions, one per allowed transition:

- `submit_order(order)` — validates status is `DRAFT`, sets status to `ORDERED`, sets `ordered_at`, calls `notify()` to tell the patient their order was placed
- `collect_sample(order)` — `ORDERED→SAMPLE_COLLECTED`, sets `sample_collected_at`
- `start_processing(order)` — `SAMPLE_COLLECTED→PROCESSING`
- `complete_order(order, results_data, entered_by)` — `PROCESSING→COMPLETED`, bulk-creates `LabOrderResult` rows, sets `completed_at`, sends two notifications (patient + doctor) for results available. If any result has `is_critical=True`, fires a third notification with `LAB_RESULT_CRITICAL` verb using all channels (SMS, email, in-app) — the escalation path for dangerous values
- `review_order(order)` — `COMPLETED→REVIEWED`, sets `reviewed_at`, notifies patient

`_assert_status(order, expected, action)` is a private helper called at the top of each transition. If `order.status != expected`, it raises `ValidationError` with a message like `"Cannot {action}: order is {current_status}, expected {expected}"`.

#### Serializers

`LabOrderSerializer` handles the complex nested write: `items` is a writable nested list. In `create()`, it creates the `LabOrder` first, then bulk-creates `LabOrderItem` rows in a single `bulk_create()` call. In `update()`, item modifications are only allowed when status is `DRAFT` — once submitted, the test list is locked.

`has_critical` is a `SerializerMethodField` that returns `True` if any of the order's results have `is_critical=True`. This lets the frontend show a critical badge without loading all results.

`LabOrderListSerializer` is the lightweight version for list views — no nested `results`, just `item_count`. This keeps list responses small.

#### Permissions: `LabOrderPermission`

Enforces the role matrix:
- **Create**: Doctor only — `request.user.role == 'DOCTOR'`
- **Submit**: Only the ordering doctor or MANAGER
- **Collect/Process/Enter Results**: Secretary or MANAGER
- **Review**: Only the ordering doctor or MANAGER
- **Delete**: Ordering doctor (DRAFT only) or MANAGER

The object-level check for delete verifies `order.status == 'DRAFT'` and raises `PermissionDenied` if not — you can't delete an order once it's been submitted to the lab.

#### `LabOrderViewSet`

The queryset scoping handles four role cases:
- **PATIENT** → `Q(patient__user=request.user)`
- **DOCTOR** → `Q(doctor__user=request.user) | Q(patient__treating_doctors__doctor__user=request.user)` — sees own orders AND orders for treating patients
- **SECRETARY/MANAGER** → all orders unfiltered

Six `@action` endpoints on top of the standard CRUD:
- `submit` — POST `/lab-orders/{id}/submit/`
- `collect_sample` — POST `/lab-orders/{id}/collect-sample/`
- `start_processing` — POST `/lab-orders/{id}/start-processing/`
- `enter_results` — POST `/lab-orders/{id}/enter-results/` — validates with `LabOrderResultSerializer(many=True)`, calls `complete_order()`
- `review` — POST `/lab-orders/{id}/review/`
- `download_result_file` — GET `/lab-orders/{id}/results/{result_pk}/download/` — returns `FileResponse` for the uploaded PDF/image

---

### Frontend Architecture

#### `labOrders.api.ts`

Nine methods covering all endpoints. The `enterResults` method handles two cases: if results contain `File` objects, each result is sent as a separate multipart `FormData` POST (one per result with a file). If no files are involved, it sends a single JSON array POST. This split is necessary because you can't mix JSON and file uploads in one request cleanly.

#### `StatusBadge.tsx` — Extended

The original `StatusBadge` only handled appointment statuses. It was extended with an optional `ns` prop (namespace, default `'status'`) that controls which i18n section to look up the label in. The `BadgeStatus` type was widened to `string` — loose enough to accept both appointment statuses (`CONFIRMED`, `IN_PROGRESS`) and lab statuses (`ORDERED`, `SAMPLE_COLLECTED`, etc.) and priorities (`ROUTINE`, `URGENT`, `STAT`).

The CSS uses BEM modifiers matching the status values directly: `.badge--ORDERED`, `.badge--SAMPLE_COLLECTED`, etc. Color choices:
- DRAFT: neutral gray
- ORDERED: blue (action needed)
- SAMPLE_COLLECTED: indigo
- PROCESSING: amber (in progress)
- COMPLETED: green (results ready)
- REVIEWED: dark green (fully closed)
- URGENT: orange; STAT: red

#### `LabStatusTimeline.tsx`

A horizontal step indicator. The six statuses are ordered in the workflow sequence. For a given order, steps before the current status get `.lab-timeline__step--done` (solid color, checkmark), the current step gets `.lab-timeline__step--active` (highlighted), and future steps are inactive (muted). On mobile it uses `overflow-x: auto` so the timeline scrolls horizontally rather than wrapping.

#### Dashboard Widgets

Three small components for the dashboard row:

- **`PendingOrdersWidget`**: Queries `labOrdersApi.list({ status: 'ORDERED', page_size: 1 })` — it only needs the `count` from the paginated response, not the actual results. Shows the count with a "View" link.
- **`CriticalResultsWidget`**: Same pattern but for `COMPLETED` status (completed = results entered but not yet reviewed by doctor — the critical alert window).
- **`RecentLabsWidget`**: Queries last 5 orders regardless of status, renders a compact list with order number, patient name, status badge, and date.

All three are added to both `DoctorDashboard` and `SecretaryDashboard` in a `.lab-kpi-row` CSS grid.

#### `CreateLabOrderPage.tsx`

Patient picker uses a searchable `Select` component populated from `medicalApi.myPatients()`. Test items are managed as local array state — each item has `test_name`, `test_code`, and `notes` fields. "Add Test" appends a new empty row; the X button removes it. There's a minimum-one-item guard on submit.

Two submit buttons: "Save as Draft" calls `labOrdersApi.create()` only. "Submit Order" calls `labOrdersApi.create()` then immediately calls `labOrdersApi.submit(newOrder.id)` — a two-step operation that creates and submits in sequence.

#### `LabOrderDetailsPage.tsx` — Shared Across Roles

This single page component serves both `/doctor/lab-orders/:id` and `/secretary/lab/:id`. It uses `useAuth()` to determine which action buttons to show:

- Doctor + `order.status === 'DRAFT'` → "Submit" and "Delete" buttons
- Doctor + `order.doctor === user.id` + `order.status === 'COMPLETED'` → "Mark Reviewed"
- Secretary + `order.status === 'ORDERED'` → "Collect Sample"
- Secretary + `order.status === 'SAMPLE_COLLECTED'` → "Start Processing"
- Secretary + `order.status === 'PROCESSING'` → shows the result entry form

The result entry form (visible to secretary when status is PROCESSING) renders one row per `order.items` entry. Each row has fields for `result_value`, `unit`, `reference_range`, `is_abnormal` and `is_critical` checkboxes, a date picker, interpretation text, and a file input.

The results table (after completion) applies `.lab-result-row--abnormal` (amber left border) or `.lab-result-row--critical` (red left border) to rows where the flags are set.

#### `PatientLabResultsPage.tsx`

Queries both `COMPLETED` and `REVIEWED` statuses in parallel (two separate `useQuery` calls merged). Renders expandable order rows — clicking an order shows its results table inline. Patients see the same abnormal/critical highlighting but have no action buttons.

#### `SampleCollectionPage.tsx`

Queries only `ORDERED` status. Renders a simple list with the order number (linked to the detail page), patient name, date, and a "Collect Sample" button. The collect mutation calls `labOrdersApi.collectSample(id)` then invalidates `['lab-orders']` to refresh all related queries.

---

### i18n — Two Files, Different Line Endings

`en.json` uses LF line endings — the `Edit` tool works normally.

`ar.json` uses Windows **CRLF** line endings — the `Edit` tool's string matching fails because it can't find the exact string in a CRLF file. Solution: use `python.exe` with `json.load()` / `json.dump()` to read, merge keys, and rewrite. The duplicate `status` key problem (two top-level `status` objects from different phases) was resolved with a custom `object_pairs_hook` that merges duplicate keys on parse rather than last-one-wins.

New i18n namespaces added:
- `vitals.*` — ~40 keys (field labels, units, alert messages, form actions, history headings)
- `lab.*` — ~50 keys (status labels, step labels, action buttons, form fields, table headers)
- `status.*` — extended with all `LabOrderStatus` and `LabOrderPriority` values (merged with existing appointment statuses)
- `nav.vitals`, `nav.labOrders`, `nav.labResults`
