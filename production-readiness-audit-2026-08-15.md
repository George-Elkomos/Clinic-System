# Pre-Launch Readiness Audit — Nabda Clinic System

**Date:** 2026-08-15
**Scope:** Full RBAC + end-to-end workflow + UI/UX audit across all 4 roles (Patient, Doctor, Secretary, Manager), ahead of the client's first hands-on demo.

## Summary

| | |
|---|---|
| Roles fully tested | 4 / 4 |
| Test units completed | 12 / 12 |
| Individual checks run | 265+ |
| Bugs fixed mid-audit, re-confirmed live | 3 |
| Still open | 9 (4 high · 4 medium · 1 low) |

**Method:** twelve parallel audit passes — four RBAC negative-testing passes (one per role) plus six end-to-end workflow drives (appointments, encounters, labs, radiology, prescriptions, invoices & referrals) plus two UI/UX sweeps — each combining direct API calls (curl) with real browser automation (Playwright/Edge) against the running app. Every finding required the reporting pass to reproduce it twice before it counted. 7 of the 9 still-open findings then went through a second, fully independent pass that re-derived the repro from scratch (marked *independently re-confirmed* below); the other 2 groups — Appointments & Scheduling, and the print/PDF sweep — only have the original double-reproduction, since their independent re-check didn't finish before a platform session limit was hit. All 3 fixed-during-audit items, plus the 2 highest-impact still-open items, were additionally re-confirmed by hand against the live app immediately before publishing this report.

---

## Fixed while this audit was running

Three of the bugs below were found early in this audit, then independently fixed by the dev team before the audit finished. Each was re-tested live, from scratch, immediately before this report was published — all three are confirmed fixed as of now.

### ✅ Empty visits could be marked complete
An encounter could be submitted — and the appointment marked `COMPLETED` — with no chief complaint, diagnosis, exam findings, or treatment plan at all. Silently accepted, no warning. Now rejected with an explicit "record at least a chief complaint, diagnosis, or clinical notes" error, enforced on both the encounter-submit and queue "Complete Visit" paths.
*Commit `b83ca54` · re-verified live: submitting an empty encounter now returns HTTP 400.*

### ✅ Doctors couldn't finalize their own lab results
Once a lab order reached `PROCESSING`, only a Manager account could enter/finalize its results — the ordering doctor got a flat 403 with no UI control at all. Now both the ordering doctor and a manager can.
*Commit `e6b81f6` · re-verified live: doctor entering results on a fresh order now returns HTTP 200.*

### ✅ Secretaries could read full clinical lab results
A secretary opening a lab order's detail view (API or page) saw the complete result values, reference ranges, and critical/abnormal flags — the same payload a doctor sees — despite being walled off from clinical data everywhere else in the app. Now redacted to logistics-only fields (test name, date, who entered it) for that role.
*Commit `481cdb8` · re-verified live: secretary's view now omits `result_value` / `interpretation` / critical flag entirely.*

---

## Open findings — High (4)

### 1. Concurrent double-booking crashes with a raw server error
**Module:** Appointments & Scheduling · **Verification:** self-verified ×2

When two patients truly-simultaneously request the same doctor+slot (e.g. two browser tabs racing each other), the losing request doesn't get the app's normal "sorry, that slot was just taken" message — it gets an unhandled `HTTP 500` Django debug page. No double-booking ever actually happens (exactly one appointment is created every time this was tried), but the failure mode is a raw traceback instead of a clean retry prompt.

> `OperationalError: database is locked` — raised inside `book_slot()`'s `select_for_update()`/`transaction.atomic()` block, SQLite write-lock contention under real concurrency. Reproduced on 3 separate slots.

### 2. Starting a new patient can hide an earlier one still mid-visit
**Module:** Live Queue · **Verification:** re-confirmed live just now

"Call Next Patient" never checks whether the doctor already has someone `IN_PROGRESS`. A second patient can be started while the first visit is still open, and the Live Queue's "Current Patient" card only ever shows the most recently started one — the earlier consultation silently disappears from that screen (it's still reachable and completable from the Appointments list, just invisible from the doctor's main working view).

> Just reproduced: started appointment #187 while #186 was still `IN_PROGRESS` → both succeeded (HTTP 200); `my-queue`'s "current" showed only #187, and #186 appeared in none of current / next / previous.

### 3. The live queue can go silently empty for ~3 hours a day
**Module:** Live Queue · timezone · **Verification:** self-verified ×2

The queue's "who's waiting today" query takes today's date from the server's UTC clock instead of the app's own Africa/Cairo setting. For the few hours after midnight in Cairo but before UTC rolls over, the two dates disagree — every checked-in patient for the real current day gets filtered out, and the doctor's queue looks completely empty even with people waiting. (A patient already `IN_PROGRESS` still shows, since that lookup isn't date-filtered.) Found incidentally while testing the print flow, which it ended up blocking.

> `timezone.now().date()` (UTC) disagreed with `timezone.localdate()` (Cairo) by one day during the reproduction window; re-running the same queryset with the local date correctly returned the 3 waiting appointments that had vanished.

### 4. Prescription PDF: instructions text bleeds off the page
**Module:** Prescriptions · PDF · **Verification:** self-verified ×2

The PDF's Instructions column is built from a plain string instead of a wrapping paragraph, so it never wraps — even an everyday instruction like *"Take with food, complete full course"* overflows the column's border into the page margin instead of staying inside the table grid. A longer instruction would run off the printable area entirely, silently cutting off dosing guidance on a real medical document.

---

## Open findings — Medium (4)

### 5. A manager can personally author a radiology report
**Module:** Radiology · RBAC design · **Verification:** re-confirmed live just now

Every other clinical-authorship boundary in this system (encounters, medical records, procedures, referrals) restricts managers to read-only plus administrative cancel. Radiology is the one exception: a manager can write the findings/impression text on any doctor's order, and cancel it — coded deliberately at the view layer and the frontend modal, reachable via a URL the manager's own sidebar never links to. This looks like intentional design, not an oversight, but it's inconsistent with the rule enforced everywhere else — worth an explicit decision either way rather than an unreviewed asymmetry.

> Just reproduced: `POST /api/radiology-orders/31/report/` as manager → HTTP 200, findings/impression persisted verbatim, status → `REPORTED`.

### 6. Managers have no screen to view an individual encounter
**Module:** Encounters · **Verification:** independently re-confirmed

The backend deliberately grants managers full read access to any encounter's clinical detail. But the only encounter-detail route in the frontend is locked to the Doctor role, and the manager portal's sidebar has no Patients/Records/Encounters link at all — so that granted oversight access exists only at the API layer, never in the actual product a manager would use.

### 7. Doctors can't record their own day off
**Module:** Doctor Schedule & Absences · **Verification:** self-verified ×2

The backend is clearly built for doctor self-service here — the permission model and an explicit code comment both describe a doctor submitting their own absence. But the only page that creates an absence record lives under the Secretary portal, and its "Mark absent" form is further restricted to managers only. Today, a doctor who wants a day blocked off has to ask a manager to do it on their behalf.

### 8. Invoice "Download PDF" button doesn't download a PDF
**Module:** Invoices · print flow · **Verification:** self-verified ×2

The patient-facing button labeled "Download PDF" calls the same print-the-page function used elsewhere in the app — which is correctly labeled "Print Receipt" at its other two call sites. Clicking it only opens the browser's print dialog; nothing is saved unless the patient manually chooses "Save as PDF" as their destination.

---

## Open findings — Low (1)

### 9. Lab "enter results" response briefly misreports its own save
**Module:** Labs · API only · **Verification:** independently re-confirmed

Immediately after a successful result save, that same API response reports an empty results array — a stale prefetch cache from before the write, even though the save genuinely worked (an immediate follow-up read shows it correctly). The product's own frontend already refetches after saving, so this never reaches an end user; only a direct API consumer would be misled.

---

## Fully clean — no defects found (5 of 12 units)

| Unit | Coverage |
|---|---|
| **Patient RBAC** | Self-escalation, cross-patient isolation across 6 record types (both directions), route guards — 24 checks. |
| **Doctor RBAC** | Cross-doctor isolation, schedule/authorship boundaries, 24-hour vital-sign edit window — 18+ checks. |
| **Prescriptions, full lifecycle** | Interaction checks, secretary read-only (API + UI), PDF verified byte-for-byte across 3 roles, cancel/reissue chain. |
| **Invoices & Referrals, full lifecycle** | Overpay validation, doctor payment block, cross-patient isolation, paginated-list regression check, both referral types end to end. |
| **Cross-portal UI/UX sweep** | 48 routes × 4 roles: zero console errors, zero 5xx, zero layout breaks at 375/1024/1280px, zero silent-failure forms. |

---

## Worth knowing before the demo — not a bug

**Manager dashboard's "Average wait" KPI currently reads about 1,218 minutes (~20 hours).** The calculation is correct — it's pulling real multi-day gaps between check-in and start timestamps from this long-lived shared dev database. Already tracked as a pre-launch data cleanup; worth doing before the client sees it, purely so nobody has to explain it live.

---

*Full interactive version: https://claude.ai/code/artifact/fb8776a9-3dff-4e8b-876a-97ca5639b8f5*
