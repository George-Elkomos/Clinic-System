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
- Records older than 24 hours show the **Edit button greyed out (disabled)**.
- If you hover over the disabled button, a tooltip appears: *"Editing is locked — this record is older than 24 hours."*
- The form **never opens** for expired records — the lock is visible before you start any editing.
- Only a **Manager** account ignores this limit and always gets a clickable Edit button.

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

---

## PART 3 — AI SCRIBE

The AI Scribe lets a Doctor **record or upload** a consultation audio, have it transcribed automatically, and get a structured clinical draft (chief complaint, diagnosis, treatment plan, vitals, prescriptions) that the doctor reviews and edits before confirming. **Nothing is written to the patient's record until the doctor clicks "Confirm & save".**

> **Prerequisites:**
> - The server must be configured with a Gemini API key (`GOOGLE_API_KEY` in `.env`) and `faster-whisper` must be installed (see `requirements.txt`).
> - You must be logged in as a **Doctor**.
> - A patient must be assigned to your doctor profile.

---

### 3.1 FINDING THE AI SCRIBE PANEL

1. Go to **Patients** in the sidebar → `/doctor/patients`.
2. Select any patient from the dropdown.
3. Scroll down through the patient sections. After Vital Signs and Medical Records, you will see a card titled **"AI Scribe — record this visit"**.
4. The panel shows a short intro line: *"Record (or upload) the consultation. It is transcribed and turned into a draft you review and confirm before anything is saved."*
5. Two controls appear:
   - A blue **"● Record session"** button
   - An **"or"** separator
   - A **"Upload audio file"** secondary button

> **Expected:** The panel is visible only to Doctors. Patients and Secretaries do not see it.

---

### 3.2 RECORD A LIVE CONSULTATION

**Starting point:** AI Scribe panel visible with a patient selected.

1. Click **"● Record session"**.
   - Your browser will ask for **microphone permission** — click **Allow**.
   - If you deny it, a red toast appears: *"Microphone access was denied or is unavailable."* — this is correct behavior.
2. Once recording starts:
   - The "Record session" button is replaced by a red **"■ Stop · 0:00"** button.
   - A running **timer** counts up every second (e.g., `■ Stop · 0:07`).
3. Speak for 10–15 seconds. Say something like:
   > *"Patient is a 45-year-old presenting with chest pain and shortness of breath. Blood pressure 130 over 85. Heart rate 92. Temperature 37.2. Diagnosis: hypertensive urgency. Treatment plan: start Amlodipine 5mg once daily for 30 days. Follow up in two weeks."*
4. Click **"■ Stop"** to finish recording.

#### What happens after stopping:
- The recording is uploaded automatically (you see *"Uploading audio…"* with a spinner).
- Status changes to *"Queued for processing…"* briefly.
- Then *"Transcribing the recording…"* (Whisper running — may take 10–60 seconds depending on audio length and server hardware).
- Then *"Extracting clinical details…"* (Gemini structuring the transcript).
- When done, the processing spinner disappears and the **draft review form** appears.

#### Success criteria:
- [ ] Timer increments while recording
- [ ] Stop button changes back after stopping
- [ ] Each processing phase label appears in sequence
- [ ] Draft form appears when extraction is complete

---

### 3.3 UPLOAD A PRE-RECORDED AUDIO FILE

Instead of recording live, you can upload an existing audio file:

1. Click the **"Upload audio file"** button (secondary/outline button).
2. A file picker opens. Select any `.mp3`, `.wav`, `.webm`, `.m4a`, or `.ogg` file that contains speech.
3. The file uploads and goes through the same processing pipeline as a live recording.

#### Notes:
- The upload button is **disabled while recording** (you cannot record and upload at the same time).
- Very short files (under 2 seconds) may produce an empty transcript — this is expected.

---

### 3.4 REVIEWING AND EDITING THE DRAFT

Once processing completes, the panel shows the **draft review form**. This is the most important step.

#### Yellow warning banner
At the top of the draft you will see:
> *"AI-generated draft — review and edit carefully before saving. Nothing is stored until you confirm."*

This is always visible as a reminder that the AI may have made mistakes.

#### Transcript toggle (optional)
- Below the warning, there is a collapsible **"▸ Show transcript"** line.
- Click it to expand and read the raw text that Whisper produced.
- Click **"▾ Show transcript"** to collapse it again.
- The transcript is **read-only** — you cannot edit it directly.

#### Draft fields to review:

| Section | Fields | What to check |
|---|---|---|
| Clinical | Chief Complaint | Should match what was spoken |
| Clinical | Diagnosis | Verify accuracy — LLMs can hallucinate |
| Clinical | Treatment Plan | Verify accuracy |
| Vitals | Blood Pressure, Heart Rate, Temperature, Respiratory Rate, O₂ Saturation, Weight | Should be extracted from audio; correct any misread numbers |
| Prescriptions | Drug name, Dosage, Frequency, Duration | Most critical — verify every field before confirming |
| Follow-up | Follow up notes | May be empty if not mentioned in audio |

#### Editing the draft:
1. Click any text field and type your corrections.
2. For prescriptions:
   - Click the **"✕ Remove"** button next to a prescription row to delete it.
   - Click **"+ Add medication"** to add a new prescription row manually.
3. All changes are **local only** — nothing is saved until you confirm.

#### Success criteria:
- [ ] All spoken values appear pre-filled in the correct fields
- [ ] You can type in any field and the value changes
- [ ] Removing a prescription row works
- [ ] Adding a prescription row adds a blank row below

---

### 3.5 CONFIRMING THE DRAFT (COMMIT)

After reviewing and correcting all fields:

1. Click the **"Confirm & save to record"** (blue primary button at the bottom).
   - A loading spinner appears on the button.
2. When complete, the draft form is replaced by a green confirmation message:
   > *"✓ The medical record (and any prescription) was saved."*
3. A green toast also appears: *"Saved to the patient's record."*

#### What gets saved:
- A new **MedicalRecord** row is created under the patient (Chief Complaint, Diagnosis, Treatment Plan).
- If there were prescriptions, a new **Prescription** row is also created.
- The **Medical Records section** and **Prescriptions section** on the same patient page will now show the new entries (you may need to scroll up to see them).

#### After confirming:
- A **"Record another session"** button appears.
- Click it to reset the panel and start a new recording for the same patient.

#### Success criteria:
- [ ] Green toast + confirmation message appears
- [ ] The new medical record appears in the patient's Medical Records section
- [ ] The new prescription appears in the patient's Prescriptions section (if any were in the draft)
- [ ] "Record another session" button appears after commit

---

### 3.6 DISCARD A DRAFT

If you decide the draft is unusable:

1. In the draft review form, click **"Discard"** (secondary button next to "Confirm & save").
2. The draft is removed and the panel resets to show the Record / Upload buttons.
3. **Nothing is saved** — no medical record or prescription is created.

#### Also works during processing:
- The **Discard** button is **not shown during transcription/extraction** — you must wait for the draft to appear before discarding.

---

### 3.7 FAILED PROCESSING

If the transcription or extraction step fails (e.g., audio was too noisy, API key missing):

1. The processing spinner is replaced by a red error box:
   > *"Processing failed."*
2. If there is a technical error message from the server, it appears in a grey code block below.
3. Two buttons appear: **"Try again"** and **"Discard"**.
4. Click **"Try again"** — the pipeline reruns from the beginning on the same uploaded file.
5. Click **"Discard"** to give up and reset the panel.

#### To test failure intentionally:
- Remove `GOOGLE_API_KEY` from `.env`, restart the server, then upload an audio file.
- The session will fail at the EXTRACTING step and show the error panel.

---

### 3.8 PERMISSIONS CHECK

| Action | PATIENT | DOCTOR | SECRETARY | MANAGER |
|---|---|---|---|---|
| See AI Scribe panel | ✗ | ✓ | ✗ | ✗ |
| Upload audio | ✗ | ✓ | ✗ | ✗ |
| Commit draft | ✗ | ✓ | ✗ | ✗ |
| View session status | ✗ | own only | ✗ | ✗ |

> The AI Scribe panel is rendered only inside the Doctor patient view — there is no route for other roles.

---

---

## PART 4 — PATIENT ROLE

Log in with a Patient account (e.g., `patient@clinic.test` / `Password123!`).

---

### 4.1 PATIENT NAVIGATION

After login, the Patient dashboard appears at `/patient`. The sidebar shows:
- Dashboard (🏠)
- My Vitals (or similar icon)
- Lab Results (🧪)
- Appointments
- Medical Records
- Prescriptions
- Profile

---

### 4.2 PATIENT — VIEW VITAL SIGNS HISTORY

1. Click **"My Vitals"** in the sidebar → URL: `/patient/vitals`
2. You will see:
   - A heading (Vital Signs)
   - If the patient has 2+ records: a **metric selector + trend chart** at the top
   - Below the chart: a scrollable history of vital sign cards, newest first

#### What the patient can and cannot do:
| Feature | Patient sees? |
|---|---|
| Vital signs cards (read-only) | ✓ Yes |
| Metric trend chart | ✓ Yes (if 2+ records) |
| Record new vitals form | ✗ No |
| Edit button | ✗ Not shown |
| Delete button | ✗ Not shown |

#### Verify read-only:
- Scroll through the history cards.
- Confirm there is **no "Edit" or "Delete" button** on any card.
- Confirm there is **no "Record" form** above the history.

#### Success criteria:
- [ ] Vitals page loads at `/patient/vitals`
- [ ] History cards show values with amber/red highlighting for abnormal values
- [ ] Trend chart visible when 2+ records exist
- [ ] No Edit or Delete buttons anywhere on the page

---

### 4.3 PATIENT — VIEW LAB RESULTS

1. Click **"Lab Results"** in the sidebar → URL: `/patient/lab-results`
2. You will see a list of lab orders that belong to this patient.

#### Important visibility rule:
Patients can **only see results for orders in COMPLETED or REVIEWED status**. Orders that are still DRAFT, ORDERED, SAMPLE_COLLECTED, or PROCESSING are **not shown** to the patient — they are still being processed.

#### To verify:
1. Log in as a Doctor in a second browser tab. Create and submit a lab order for this patient.
2. Switch to the Patient tab. Refresh the page.
3. The new order (status = ORDERED) should **not appear** in the patient's list.
4. As a Secretary, advance the order through SAMPLE_COLLECTED → PROCESSING → COMPLETED.
5. Go back to the Patient tab. Refresh.
6. The order **now appears** with the status "Completed".

#### What the patient sees on each order:
- Order number (e.g., `LAB-2026-0001`)
- Patient name (their own)
- Doctor name
- Status badge
- Date
- An expandable row or link to the results table

#### Results table (if order is COMPLETED or REVIEWED):
- Each row: Test Name, Result Value, Unit, Reference Range, Result Date
- Abnormal rows have an **amber left border**
- Critical rows have a **red left border**

#### Success criteria:
- [ ] Orders only visible at COMPLETED or REVIEWED status
- [ ] Orders still in progress are hidden
- [ ] Result rows show amber/red borders for abnormal/critical values
- [ ] Patient cannot see a "Mark as Reviewed" or any action button
- [ ] Patient cannot create or modify any order

---

---

## PART 5 — MANAGER ROLE

Log in with the Manager account: `manager@clinic.test` / `Password123!`.

The Manager is a **superuser** within the application — they can perform any action across all roles. The sections below focus on the actions that are **exclusive to Manager** or work differently compared to Doctor/Secretary.

---

### 5.1 MANAGER NAVIGATION

After login, the sidebar shows all sections: Patients, Vital Signs, Lab Orders, Appointments, Medical Records, Users, Reports, Dashboard.

---

### 5.2 MANAGER — EDIT VITAL SIGNS WITH NO TIME LIMIT

Unlike Doctors (24-hour window) and Secretaries (24-hour window), a Manager can edit **any vital signs record regardless of age**.

1. Go to **Patients** → select a patient.
2. Scroll to the Vital Signs section.
3. Find a record that was created **more than 24 hours ago**.
4. Confirm the **Edit button is NOT greyed out** — it is fully clickable (no disabled state, no tooltip).
5. Click **Edit**.
6. Change **Respiratory Rate** to `15`.
7. Click **Save**.

#### Expected results:
- Green toast: record saved
- Updated card appears with the new value
- No "edit window expired" error at any point

#### Success criteria:
- [ ] Edit button is active (not disabled) on records older than 24h
- [ ] No tooltip appears on hover
- [ ] Edit saves successfully

---

### 5.3 MANAGER — DELETE VITAL SIGNS

Only a Manager can permanently delete vital sign records.

1. In the Vital Signs history, find any record.
2. Click the red **"Delete"** button (visible only to Manager and not to Doctor).
3. Confirm the dialog.

#### Expected results:
- Green toast: "Vital signs deleted"
- The card disappears from the history

#### Contrast with Doctor:
- As a Doctor, the Delete button is shown but returns a **403 permission error** when clicked — this is intentional (they can see but not do).
- As a Manager, Delete actually works.

---

### 5.4 MANAGER — ADVANCE ANY LAB ORDER STAGE

The Manager can perform every stage transition that Doctors and Secretaries can:

| Transition | Button label | Status it appears at |
|---|---|---|
| DRAFT → ORDERED | Submit Order | DRAFT |
| ORDERED → SAMPLE_COLLECTED | Collect Sample | ORDERED |
| SAMPLE_COLLECTED → PROCESSING | Start Processing | SAMPLE_COLLECTED |
| PROCESSING → COMPLETED | Enter Results | PROCESSING |
| COMPLETED → REVIEWED | Mark as Reviewed | COMPLETED |
| DRAFT (delete) | Delete Order | DRAFT |

#### To verify Manager can submit a Doctor-created order:
1. As a Doctor, create a lab order and save it as Draft.
2. Log out and log in as a Manager.
3. Navigate to the order detail page.
4. Confirm the **"Submit Order"** button is visible and clickable.
5. Click it — order advances to ORDERED.

---

### 5.5 MANAGER — USER MANAGEMENT

1. Go to **Users** in the sidebar (if visible at `/manager/users` or similar).
2. You can view all registered users, their roles, and active status.
3. Confirm that Doctors, Secretaries, and Patients are listed with their correct roles.

---

### 5.6 MANAGER — DASHBOARD

The Manager dashboard shows all the same widgets as Doctor + Secretary:
- Pending Orders count
- Critical Results count
- Recent Lab Orders list

All counts reflect **all doctors' orders** (not just the manager's own), because the Manager has global visibility.

---

---

## COMPLETE TEST CHECKLIST

### Vital Signs (Doctor)
- [ ] Select a patient on the Patients page
- [ ] Vital Signs section appears as the first section
- [ ] Create a record with normal values — no colored tiles
- [ ] Create a record with warning values — amber tiles appear
- [ ] Create a record with danger values — red tiles appear
- [ ] BMI calculates automatically from weight + height
- [ ] Trend chart appears after 2+ records exist
- [ ] Metric selector on chart works (try all 5 metrics)
- [ ] History shows 5 records per page with pagination arrows
- [ ] Edit a recent record — values pre-fill, save updates the card
- [ ] Edit button is **greyed out** on records older than 24h (tooltip visible on hover)
- [ ] Delete shows confirmation dialog
- [ ] Delete Cancel closes dialog without deleting
- [ ] Delete as Doctor returns 403 error (correct behavior)

### Lab Orders (Doctor + Secretary)
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

### AI Scribe (Doctor)
- [ ] AI Scribe panel visible on patient page (Doctor only)
- [ ] Microphone permission prompt appears on "Record session"
- [ ] Timer counts up while recording
- [ ] Stop button stops recording and uploads
- [ ] Processing phases shown: Uploading → Queued → Transcribing → Extracting
- [ ] Draft form appears after successful extraction
- [ ] Yellow warning banner visible in draft form
- [ ] All spoken values appear in correct fields
- [ ] All draft fields are editable
- [ ] Transcript toggle expands/collapses raw transcript
- [ ] Prescriptions can be added and removed
- [ ] "Confirm & save" writes the medical record and prescription
- [ ] Saved record appears in Medical Records section
- [ ] Saved prescription appears in Prescriptions section
- [ ] "Record another session" resets the panel
- [ ] "Discard" resets without saving anything
- [ ] Upload audio file button works as an alternative to live recording

### Patient Role
- [ ] Patient can view their vitals at `/patient/vitals`
- [ ] No Edit or Delete buttons on vitals cards
- [ ] Trend chart visible with 2+ records
- [ ] Patient cannot see orders in DRAFT/ORDERED/PROCESSING status
- [ ] Patient can see results for COMPLETED and REVIEWED orders
- [ ] Abnormal/critical row colors visible to patient
- [ ] Patient has no action buttons on lab orders

### Manager Role
- [ ] Edit button active on vitals records older than 24h (no greyed-out state)
- [ ] Edit saves successfully for old records
- [ ] Delete vital signs actually deletes (green toast, card removed)
- [ ] Manager can submit Doctor-created DRAFT orders
- [ ] Manager can perform all 5 lab order stage transitions
- [ ] Manager dashboard shows counts across all doctors
