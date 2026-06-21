# QA Testing Guide — Doctor Role
## Vital Signs + Lab Orders

> **Before you start:** Log in with a Doctor account. Make sure at least one patient is assigned to your doctor profile. All tests below assume you are already logged in and on the Doctor Dashboard (`/doctor`).

---

## PART 1 — VITAL SIGNS

---

### 1.1 Navigation to Vital Signs

1. Look at the **left sidebar**. You will see a navigation menu with icons.
2. Click **"Patients"** (👤 icon) in the sidebar.
   - URL changes to `/doctor/patients`
3. You will see a page titled **"Patients"** with a dropdown labeled **"Select Patient"**.
4. Click the dropdown. It is **searchable** — you can type a patient's name to filter.
5. Select any patient from the list.
6. As soon as you select a patient, **multiple sections appear below the dropdown** stacked vertically:
   - **Vital Signs** (first — appears at the top)
   - Medical Records
   - Clinical Notes
   - Prescriptions
   - Scans / Labs

> **Expected:** The Vital Signs section appears immediately after selecting a patient, before all other sections.

---

### 1.2 CREATE VITAL SIGNS — Normal Values

**Starting point:** You are on `/doctor/patients` with a patient selected. The Vital Signs card is visible.

#### What you see inside the Vital Signs card:
- A heading **"Vital Signs"**
- If this patient has fewer than 2 existing records: no chart is shown yet
- A sub-heading **"Record"** with a form directly below it
- A sub-heading **"History"** below the form (may say "No history yet")

#### Step-by-step — Enter normal vitals:

1. The form has **4 rows of paired fields** (2 columns each). Fill them in this order:

   **Row 1 — Blood Pressure:**
   - **BP Systolic:** `120`
   - **BP Diastolic:** `80`

   **Row 2 — Heart Rate + Temperature:**
   - **Heart Rate:** `72`
   - **Temperature:** `36.8`

   **Row 3 — Respiratory Rate + Oxygen Saturation:**
   - **Respiratory Rate:** `16`
   - **Oxygen Saturation:** `98`

   **Row 4 — Weight + Height:**
   - **Weight:** `70.0`
   - **Height:** `175`

2. After entering weight and height, look for a **BMI display box** below the 4 rows. It should now show `22.9` (calculated automatically — you cannot type in it).

3. **Blood Glucose (optional):** Leave empty (it is not required).

4. **Notes:** Type `Routine checkup, patient feeling well`

5. Click the **"Save"** button (bottom-right of the form).

#### Expected results:
- A **green success toast** appears at the bottom/top of the screen saying the record was saved.
- The form **clears** automatically.
- A new entry appears under **"History"** below.
- The history entry shows a card with all the values you entered, with **no colored highlights** (all values are normal).

#### Success criteria:
- [ ] Toast appears and is green
- [ ] Form fields are cleared after save
- [ ] New card appears in History section
- [ ] All metric tiles show normal (no red or amber text)
- [ ] BMI tile shows `22.9`

---

### 1.3 CREATE VITAL SIGNS — Warning Values

1. Fill the form with these values that trigger **amber/warning** color:

   | Field | Value | Why it triggers warning |
   |---|---|---|
   | BP Systolic | `145` | > 140 |
   | BP Diastolic | `92` | > 90 |
   | Heart Rate | `105` | > 100 |
   | Temperature | `37.8` | > 37.5 |
   | Respiratory Rate | `18` | (normal) |
   | Oxygen Saturation | `93` | < 95 |
   | Weight | `90.0` | |
   | Height | `170` | BMI will be ~31.1 → danger (see below) |
   | Blood Glucose | `150` | > 140 |

2. Click **"Save"**.

#### Expected results:
- In the History card that appears:
  - **BP Systolic** value text is **amber/orange**
  - **BP Diastolic** value text is **amber/orange**
  - **Heart Rate** value text is **amber/orange**
  - **Temperature** value text is **amber/orange**
  - **SpO2** value text is **amber/orange**
  - **Blood Glucose** value text is **amber/orange**
  - **BMI** value text is **red** (BMI 31.1 > 30 = danger threshold)

---

### 1.4 CREATE VITAL SIGNS — Danger Values

1. Fill the form with these values that trigger **red/danger** color:

   | Field | Value | Why it triggers danger |
   |---|---|---|
   | BP Systolic | `185` | > 180 |
   | BP Diastolic | `95` | > 90 |
   | Heart Rate | `155` | > 150 |
   | Temperature | `39.5` | > 39 |
   | Respiratory Rate | `14` | (normal) |
   | Oxygen Saturation | `88` | < 90 |
   | Weight | `70.0` | |
   | Height | `175` | |
   | Blood Glucose | `210` | > 200 |

2. Click **"Save"**.

#### Expected results:
- In the History card:
  - **BP Systolic** value is **red**
  - **Heart Rate** value is **red**
  - **Temperature** value is **red**
  - **SpO2** value is **red**
  - **Blood Glucose** value is **red**

---

### 1.5 VIEW VITAL SIGNS HISTORY

After creating 2+ records, the History section shows cards stacked vertically.

#### What each card shows:
- A grid of tiles: BP Systolic, BP Diastolic, Heart Rate, Temperature, Respiratory Rate, SpO2, Weight, Height, BMI, Blood Glucose
- Each tile has a label and a value. Abnormal values appear in amber or red.
- A meta line at the bottom: "Recorded by Dr. [name] on [date]"
- Two buttons: **Edit** and **Delete**

#### Pagination:
- History shows **5 records per page**
- If you have more than 5, navigation arrows `‹` and `›` appear at the bottom of the history section
- Click `›` to go to the next page, `‹` to go back

---

### 1.6 VIEW TREND CHART

The trend chart appears **above the form** inside the Vital Signs card, but **only when the patient has 2 or more records**.

#### What you see:
- A **metric selector dropdown** (e.g. "BP Systolic")
- An **SVG line chart** below the selector
- The line connects data points from oldest (left) to newest (right)
- The line color reflects the **worst alert level** across all plotted points:
  - All normal → default color
  - Any warning → amber line
  - Any danger → red line

#### How to interact:
1. Click the metric dropdown above the chart.
2. Select a different metric, e.g. **"Heart Rate"**.
3. The chart redraws for the selected metric.
4. Available metrics to switch between: BP Systolic, Heart Rate, Oxygen Saturation, Temperature, BMI.

#### Edge case:
- If only 1 record exists: no chart is shown. Create a second record and the chart appears automatically.

---

### 1.7 EDIT VITAL SIGNS

1. In the History section, find a record card.
2. Click the **"Edit"** button on that card.
3. The card collapses and is replaced by the edit form, pre-filled with the existing values.
4. Change **Heart Rate** from its current value to `68`.
5. Click **"Save"**.

#### Expected results:
- Green toast: record saved
- The edit form disappears
- The updated card re-appears with the new Heart Rate value
- If you changed a value from danger to normal, the red color on that tile should disappear

#### Edge case — 24-hour edit window:
- If you try to edit a record that was created **more than 24 hours ago**, you will see a **red error toast** saying the edit window has expired.
- The save button will fail and the form will remain open.
- You **cannot** edit records older than 24 hours as a Doctor. Only a Manager role can do this.

---

### 1.8 DELETE VITAL SIGNS

> **Important:** Only a Manager can delete vital signs. As a Doctor, the Delete button is visible but will return a 403 error. This is correct behavior — test it anyway to confirm.

1. In the History section, click **"Delete"** on any record card.
2. A **confirmation dialog** appears with a title "Delete Vital Signs?" and a message asking you to confirm.
3. The dialog has two buttons: a **Cancel** button and a **red Delete** button.
4. Click **Cancel** first — the dialog closes and nothing happens (record still there). ✓
5. Click **Delete** again, then click the red **Delete** button in the dialog.

#### Expected results if you are a Doctor:
- A **red error toast** appears — permission denied (403). The record is NOT deleted.
- This is correct. Doctors cannot delete vital signs.

#### What a Manager would see:
- Green toast: "Vital signs deleted"
- The card disappears from the history

---

### 1.9 VALIDATION ERRORS TO TEST

Test each of these one at a time by submitting the form with invalid data:

| Test | What to do | Expected error |
|---|---|---|
| Empty required field | Clear BP Systolic, click Save | Red error appears under the empty field |
| Diastolic ≥ Systolic | BP Systolic = 100, BP Diastolic = 110, click Save | Error under BP Diastolic: "Diastolic must be less than systolic" |
| All fields empty | Click Save without filling anything | All required fields show red error messages |

---

---

## PART 2 — LAB ORDERS

The lab order workflow has **6 stages**:
```
DRAFT → ORDERED → SAMPLE_COLLECTED → PROCESSING → COMPLETED → REVIEWED
```

As a Doctor, you can move orders from DRAFT → ORDERED (submit) and from COMPLETED → REVIEWED (review). The middle stages (collect sample, start processing, enter results) are done by the Secretary role — but you can view the order at every stage.

---

### 2.1 Navigation to Lab Orders

1. In the **left sidebar**, click **"Lab Orders"** (🧪 icon).
   - URL changes to `/doctor/lab-orders`
2. You will see the **Lab Orders** page with:
   - A heading "Lab Orders"
   - A **"New Lab Order"** button in the top-right (only visible to Doctors)
   - Two **KPI widget cards** below the heading: "Pending Orders" and "Critical Results" — both show a count (may show 0 initially)
   - A **filter bar** with a Status dropdown
   - An **orders table** below (may be empty on first use)

---

### 2.2 CREATE A LAB ORDER (Save as Draft)

**Starting point:** `/doctor/lab-orders`

1. Click the **"New Lab Order"** button (top-right).
   - URL changes to `/doctor/lab-orders/new`
   - Breadcrumbs at the top show: Home > Lab Orders > New Order

2. You will see a single card with a form. Fill it in:

   **Patient:** Click the Patient dropdown (it is searchable — type a name). Select any patient.

   **Priority:** Leave as **"Routine"** (default).

   **Clinical Notes:** Type `Patient requested routine blood work`

   **Tests section:** You will see one row with three fields:
   - **Test Name:** `Complete Blood Count`
   - **Test Code:** `CBC` (optional)
   - **Notes:** leave empty

3. Click **"+ Add Test"** button to add a second test row:
   - **Test Name:** `Lipid Panel`
   - **Test Code:** `LIPID`
   - **Notes:** leave empty

4. Click **"Save as Draft"** (the secondary/outline button on the left of the two bottom buttons).

#### Expected results:
- Green toast: "Draft saved"
- You are **redirected** to the order detail page at `/doctor/lab-orders/{id}`
- The order detail page shows:
  - Order number at the top: `LAB-2026-0001` (or next in sequence)
  - A **status timeline** at the top showing 6 steps — only **DRAFT** is highlighted (first step active)
  - Patient name, your name as doctor, Priority badge: "Routine", creation date
  - A list of the 2 tests you added: Complete Blood Count (CBC), Lipid Panel (LIPID)
  - **Two action buttons** at the bottom: "Submit Order" and "Delete Order" (red)

#### Success criteria:
- [ ] Redirected to detail page
- [ ] Order number is in format LAB-YYYY-NNNN
- [ ] Timeline shows DRAFT as the active step
- [ ] Both test items appear in the list
- [ ] "Submit Order" and "Delete Order" buttons are visible

---

### 2.3 VIEW THE ORDER IN THE LIST

1. Click **"Lab Orders"** in the sidebar to go back to the list page.
2. Find your order in the table. You should see:
   - **Order Number** column: `LAB-2026-0001`
   - **Patient** column: patient name
   - **Status** column: a **gray badge** labeled "Draft"
   - **Priority** column: a badge labeled "Routine"
   - **Date** column: today's date
   - An **"Actions"** button in the last column

3. Click the **"Actions"** button to go back to the detail page.

#### Filter test:
4. In the **Status dropdown** filter at the top of the table, select **"Draft"**.
5. Only DRAFT orders appear. Select **"Ordered"** — your order disappears (it is still a draft).
6. Select the blank option (no filter) to show all orders again.

---

### 2.4 SUBMIT THE ORDER (DRAFT → ORDERED)

**Starting point:** Order detail page at `/doctor/lab-orders/{id}`

1. Click the **"Submit Order"** button (at the bottom of the card).
2. The button shows a loading spinner briefly.

#### Expected results:
- Green toast: "Order submitted"
- The **status timeline updates** — "DRAFT" step gets a checkmark, **"ORDERED"** step becomes active/highlighted
- The **"Submit Order"** and **"Delete Order"** buttons **disappear** (you can no longer submit or delete)
- The **Pending Orders** widget on the dashboard should now show count = 1 (this order is waiting for sample collection)

#### Success criteria:
- [ ] Status badge changes from "Draft" to "Ordered" (now blue)
- [ ] Timeline shows DRAFT completed, ORDERED active
- [ ] Action buttons are gone (order is now locked from doctor editing)

---

### 2.5 WHAT HAPPENS NEXT — SECRETARY STAGES

As a Doctor you **cannot** perform these stages. This is what a Secretary would do:

| Stage | Who does it | Where | What to click |
|---|---|---|---|
| ORDERED → SAMPLE_COLLECTED | Secretary | `/secretary/lab` | "Collect Sample" button next to the order |
| SAMPLE_COLLECTED → PROCESSING | Secretary | Order detail page | "Start Processing" button |
| PROCESSING → COMPLETED | Secretary | Order detail page | "Enter Results" button → fill form → save |

To simulate the full workflow during QA, log in as a Secretary account in a separate browser tab and follow steps 2.6 and 2.7 below.

---

### 2.6 SECRETARY — COLLECT SAMPLE (ORDERED → SAMPLE_COLLECTED)

> Switch to a **Secretary** account for this step.

1. In the Secretary sidebar, click **"Lab Orders"** (🧪).
   - URL: `/secretary/lab`
2. You see the **"Collect Sample"** section showing all ORDERED orders.
3. Find your order (LAB-2026-0001). You will see:
   - Order number as a clickable link
   - Patient name and creation date
   - A **"Collect Sample"** button on the right
4. Click **"Collect Sample"**.

#### Expected results:
- Green toast: "Sample collected"
- The order **disappears** from this list (it is no longer in ORDERED status)
- If you click the order number link to go to the detail page, the timeline now shows SAMPLE_COLLECTED as active

---

### 2.7 SECRETARY — START PROCESSING + ENTER RESULTS

> Still on the **Secretary** account.

1. Navigate to the order detail page (click the order number link, or go to `/secretary/lab/{id}`).
2. The timeline shows **SAMPLE_COLLECTED** as active.
3. Click **"Start Processing"** button.
   - Toast: "Processing started"
   - Timeline moves to **PROCESSING**
4. Now the **"Enter Results"** button appears.
5. Click **"Enter Results"**.
   - A result entry form appears below.
6. Click **"+ Add Test"** to add a result row.
7. Fill in the first result row:
   - **Test Name:** `Complete Blood Count`
   - **Result Value:** `14.5`
   - **Unit:** `g/dL`
   - **Reference Range:** `12.0 - 16.0`
   - **Result Date:** (today's date — pre-filled)
   - **Abnormal:** leave unchecked
   - **Critical:** leave unchecked
8. Click **"+ Add Test"** again for the second result:
   - **Test Name:** `Lipid Panel - LDL`
   - **Result Value:** `210`
   - **Unit:** `mg/dL`
   - **Reference Range:** `< 100`
   - **Result Date:** today
   - **Abnormal:** ✓ check this box
   - **Critical:** leave unchecked
9. Click **"Enter Results"** (the primary blue button at the bottom of the form).

#### Expected results:
- Green toast: "Results saved"
- The result entry form closes
- A **results table** appears in the card showing both results
- The **second row** (LDL = 210) has an **amber left border** (abnormal highlighting)
- The timeline moves to **COMPLETED**
- The **Critical Results** widget on the dashboard now shows count = 0 (no critical results in this order)

---

### 2.8 SECRETARY — ENTER CRITICAL RESULTS (test scenario)

To test critical result highlighting, create a second lab order and enter a critical result:

1. As a Doctor, create a new order with test "Potassium".
2. Submit it.
3. As a Secretary, collect sample, start processing, then enter results:
   - **Test Name:** `Potassium`
   - **Result Value:** `6.8`
   - **Unit:** `mEq/L`
   - **Reference Range:** `3.5 - 5.0`
   - **Abnormal:** ✓ checked
   - **Critical:** ✓ checked
4. Click "Enter Results".

#### Expected results:
- The result row has a **red left border** (critical highlighting)
- A **red/orange warning banner** appears at the top of the order card: "⚠ Has Critical Results"
- The **Critical Results** widget on the Doctor and Secretary dashboards shows count = 1

---

### 2.9 DOCTOR — REVIEW ORDER (COMPLETED → REVIEWED)

> Switch back to the **Doctor** account.

1. Go to **Lab Orders** in the sidebar → `/doctor/lab-orders`
2. Find the completed order. The status badge shows **"Completed"** (green).
3. Click **"Actions"** to open the detail page.
4. You will now see:
   - The full results table with all entries
   - Abnormal rows highlighted amber, critical rows highlighted red
   - A **"Mark as Reviewed"** button at the bottom
5. Click **"Mark as Reviewed"**.

#### Expected results:
- Green toast: "Order reviewed"
- Status badge changes to **"Reviewed"** (dark green)
- Timeline shows all 6 steps with checkmarks
- The **"Mark as Reviewed"** button disappears — no more actions available

#### Success criteria:
- [ ] All 6 timeline steps show checkmarks
- [ ] Status badge shows "Reviewed"
- [ ] No action buttons remain
- [ ] Results table still visible for reference

---

### 2.10 DELETE AN ORDER (DRAFT ONLY)

You can only delete an order while it is in **DRAFT** status.

1. Create a new lab order (follow steps in 2.2).
2. Do **not** submit it — leave it as DRAFT.
3. On the detail page, click the red **"Delete Order"** button.
4. A confirmation dialog appears: "Delete Lab Order?" — with a Cancel and a red Delete button.
5. Click **Cancel** first — dialog closes, order remains. ✓
6. Click **Delete Order** again, then click the red **Delete** button.

#### Expected results:
- Green toast: "Order deleted"
- You are redirected back to `/doctor/lab-orders`
- The deleted order no longer appears in the list

#### Edge case — cannot delete a submitted order:
1. Create an order, submit it (status = ORDERED).
2. Try clicking "Delete Order" — the button is **not visible** at all.
3. This is correct — submitted orders cannot be deleted by a Doctor.

---

### 2.11 DASHBOARD WIDGETS

Navigate to **Dashboard** (click the 🏠 icon in the sidebar → `/doctor`).

The dashboard shows three lab order widgets:

| Widget | What it shows | When count increases |
|---|---|---|
| **Pending Orders** | Count of ORDERED orders | After you submit an order |
| **Critical Results** | Count of COMPLETED orders | After secretary enters results with "Critical" checked |
| **Recent Lab Orders** | Last 5 orders regardless of status | Always shows latest orders |

#### Verify Pending Orders widget:
1. Submit a new lab order.
2. Go back to Dashboard.
3. **Pending Orders** count should be ≥ 1.
4. Click the **"View"** link inside the widget — should navigate to the lab orders list filtered by that status.

#### Verify Recent Orders widget:
1. The widget shows a list of the 5 most recent orders with order number, patient name, status badge, and date.

---

### 2.12 VALIDATION ERRORS FOR LAB ORDERS

Test each scenario on the Create Lab Order page:

| Test | What to do | Expected |
|---|---|---|
| No patient selected | Leave Patient dropdown blank, click Submit | Button is disabled (greyed out — cannot click) |
| No tests entered | Clear the Test Name field, click Submit | Button is disabled — `canSubmit` requires at least one test name |
| Empty Test Name row | Add a second row but leave it blank, click Submit | Blank rows are silently ignored — only rows with a test name are sent |

The "Submit Order" and "Save as Draft" buttons are **disabled** (greyed out) until both a patient is selected AND at least one test name is filled in.

---

## QUICK REFERENCE — Status Colors

### Vital Signs Alert Colors
| Alert Level | When | Color of value text |
|---|---|---|
| Normal | All values in safe range | Default (dark) |
| Warning | Mildly out of range | Amber / orange |
| Danger | Severely out of range | Red |

### Lab Order Status Badge Colors
| Status | Badge color |
|---|---|
| Draft | Gray |
| Ordered | Blue |
| Sample Collected | Indigo/Purple |
| Processing | Amber |
| Completed | Green |
| Reviewed | Dark green |

### Lab Order Priority Badge Colors
| Priority | Color |
|---|---|
| Routine | Gray/neutral |
| Urgent | Orange |
| Stat | Red |

---

## COMPLETE TEST CHECKLIST

### Vital Signs
- [ ] Select a patient on the Patients page
- [ ] Vital Signs section appears as the first section
- [ ] Create a record with normal values — no colored tiles
- [ ] Create a record with warning values — amber tiles appear
- [ ] Create a record with danger values — red tiles appear
- [ ] BMI calculates automatically from weight + height
- [ ] Trend chart appears after 2+ records exist
- [ ] Metric selector on chart works (try all 5 metrics)
- [ ] History shows 5 records per page with pagination arrows
- [ ] Edit a record — values pre-fill, save updates the card
- [ ] Edit 403 error appears for records older than 24h
- [ ] Delete shows confirmation dialog
- [ ] Delete Cancel closes dialog without deleting
- [ ] Delete as Doctor returns 403 error (correct behavior)

### Lab Orders
- [ ] Lab Orders nav link works from sidebar
- [ ] "New Lab Order" button is visible (Doctor role)
- [ ] Patient dropdown is searchable
- [ ] Test items can be added with "Add Test" button
- [ ] Test items can be removed with "Remove" button (only when 2+ exist)
- [ ] Save as Draft redirects to detail page with DRAFT status
- [ ] Detail page shows 6-step timeline with DRAFT active
- [ ] Both test names appear in the order
- [ ] Filter dropdown on list page works for all statuses
- [ ] Submit Order changes status to ORDERED
- [ ] Submit removes action buttons for doctor
- [ ] Pending Orders widget count increases after submit
- [ ] Secretary can collect sample (ORDERED → SAMPLE_COLLECTED)
- [ ] Secretary can start processing (SAMPLE_COLLECTED → PROCESSING)
- [ ] Secretary sees "Enter Results" button at PROCESSING stage
- [ ] Abnormal result row has amber left border
- [ ] Critical result row has red left border + warning banner
- [ ] Critical Results widget count increases for critical results
- [ ] Doctor sees "Mark as Reviewed" button at COMPLETED stage
- [ ] Marking reviewed shows all 6 timeline steps with checkmarks
- [ ] No actions available after REVIEWED
- [ ] Delete a DRAFT order — confirmation dialog → order removed from list
- [ ] Delete button not visible on non-DRAFT orders
- [ ] Dashboard widgets show correct counts
