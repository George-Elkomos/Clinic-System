# دليل اختبار Phase 15 — Radiology Order Templates

هدف الملف ده: تختبر المرحلة دي **مرة واحدة** من غير ما تعمل تسجيل مريض / حجز موعد / تشيك-إن يدوي كل مرة.

الفرونت إند بقى جاهز وشغال، فبقى عندك 3 طرق:
- **الطريقة الأولى (الأسرع، تيست آلي كامل):** أمر واحد يشغّل كل السيناريوهات تلقائي ويطلعلك النتيجة (نجح/فشل) — من غير سيرفر شغال ولا متصفح خالص.
- **الطريقة التانية:** تلمس الـ API بإيدك (Postman / curl).
- **الطريقة التالتة (Recommended لو عايز تشوفها بعينك في المتصفح):** خطوات دوس-دوس بالماوس، بنفس الأسامي والأزرار الموجودة فعليًا في الشاشة، من غير ما تسجل مريض أو تحجز ميعاد يدويًا خالص.

---

## الطريقة الأولى — تشغيل التيست الآلي (Recommended)

المرحلة دي فيها ملف تيست جاهز (`Backend/tests/test_radiology.py`) بيغطي **كل الأوبشنز** اللي في السبيسيفكيشن، من غير ما يحتاج سيرفر شغال أو باتينت حقيقي — بيستخدم قاعدة بيانات تيست منفصلة وبيبني كل حاجة برمجيًا.

```bash
cd Backend
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe -m pytest tests/test_radiology.py -v
```

بياخد حوالي دقيقة-دقيقة ونص، وبيطلعلك 22 نتيجة. لو كلها `PASSED` يبقى كل حاجة شغالة. ده الشيك-ليست اللي بيتغطى (لو حبيت تتأكد كل أوبشن مذكور فعلاً):

| # | البند | اسم التيست |
|---|---|---|
| 1 | الدكتور يقدر يعمل Template | `test_doctor_can_create_template` |
| 2 | المريض يقرا بس، ميعدلش Template | `test_patient_cannot_write_template` |
| 3 | السكرتيرة تقرا بس، ميعدلش Template | `test_secretary_cannot_write_templates_but_can_read` |
| 4 | عمل Order من Template بيسحب الاسم تلقائي + accession number | `test_create_from_template_denormalizes_study_name` |
| 5 | عمل Order بـ study_name حر (من غير Template) | `test_create_custom_order` |
| 6 | لازم Template أو study_name، غير كده Error 400 | `test_create_requires_template_or_study_name` |
| 7 | الدكتور مينفعش يعمل Order لمريض مش بتاعه | `test_doctor_cannot_create_for_untreated_patient` |
| 8 | المريض مينفعش يعمل Order لنفسه | `test_patient_cannot_create_order` |
| 9 | السيناريو الكامل: ORDERED → complete (برفع صورة) → COMPLETED → report → REPORTED | `test_full_lifecycle_complete_then_report` |
| 10 | مينفعش تعمل report قبل ما تكمل الأوردر | جوه نفس التيست فوق |
| 11 | مينفعش تكمل نفس الأوردر مرتين | جوه نفس التيست فوق |
| 12 | مينفعش تلغي أوردر اتعمله report | جوه نفس التيست فوق |
| 13 | إلغاء الأوردر شغال من ORDERED و من COMPLETED | `test_cancel_from_ordered_and_completed` |
| 14 | السكرتيرة تقدر "تكمل" الأوردر (ترفع الصورة) | `test_secretary_can_complete_order` |
| 15 | المريض مينفعش "يكمل" الأوردر بتاعه | `test_patient_cannot_complete_order` |
| 16 | دكتور تاني (مش بتاع المريض ده) ميشوفش الأوردر خالص | `test_unrelated_doctor_cannot_complete_order` |
| 17 | السكرتيرة مينفعش تعمل "Report" (ده شغل الدكتور/المدير بس) | `test_secretary_cannot_report_order` |
| 18 | المدير يقدر يعمل "Report" | `test_manager_can_report_order` |
| 19 | كل رول بيشوف اللي يخصه بس (مريض/دكتور/سكرتيرة/مدير) | `test_role_scoping` |
| 20 | حذف الأوردر شغال بس وهو لسه ORDERED | `test_ordering_doctor_can_delete_only_while_ordered` |
| 21 | التنبيهات (Notifications) بتتبعت في كل خطوة (created/completed/reported/cancelled) | `test_notification_sent_on_order_complete_report_cancel` |
| 22 | القوالب المزروعة (Seed) لها اسم عربي | `test_seed_templates_are_bilingual` |
| 23 | سجل المراجعة (Audit Log) بيسجل كل حاجة | `test_audit_log_records_radiology_order_lifecycle` |
| 24 | الصورة اللي اترفعت في "complete" فعلاً بتترفع وتتحمل تاني | `test_completed_scan_downloadable_through_scan_viewset` |

لو عايز تشوف كل الـ Backend مش بس Phase 15 (تتأكد إن حاجتك الجديدة معملتش مشكلة في مراحل قديمة):
```bash
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe -m pytest
```

---

## الطريقة التانية — تجربة يدوية عبر الـ API (Postman / curl)

### الخطوة 0: جهّز البيانات (مرة واحدة، وآمن تكرره براحتك)

```bash
cd Backend
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe manage.py seed_radiology_templates
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe manage.py seed_radiology_e2e
```

الأمر التاني ده **بيعمل كل اللي إنت بتضيع وقتك فيه تلقائي**:
- يجهز حساب مريض جاهز اسمه `e2e.patient4@test.dev` وواقف في طابور دكتور `e2e.doctor@test.dev` جاهز يتنادى عليه (مفيش داعي تسجل مريض جديد ولا تحجز ميعاد).
- يعمل 4 Orders جاهزين، واحد في كل حالة:
  - **ORDERED** (من قالب Chest X-Ray)
  - **COMPLETED** (من قالب Abdominal Ultrasound + صورة مرفوعة فعليًا)
  - **REPORTED** (من قالب Head CT + تقرير مكتوب)
  - **CANCELLED** (أوردر حر باسم Wrist X-Ray)

آمن تشغله كذا مرة: المرة اللي بعدها هيقولك "already have one, left as-is" بدل ما يكرر البيانات.

### الخطوة 1: شغّل السيرفر (لو مش شغال)

```powershell
.\dev.ps1 restart
```

### الخطوة 2: سجل دخول واخد التوكن

كل الحسابات كلمة سرها: `E2eTest123!`

```bash
curl -s -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e.doctor@test.dev","password":"E2eTest123!"}'
```

هيرجعلك JSON فيه `"access": "eyJ..."` — ده التوكن اللي هتحطه في كل الطلبات الجاية في هيدر:
`Authorization: Bearer <access_token>`

(لو بتشتغل بـ bash تقدر تحفظه في متغير على طول:)
```bash
DOCTOR_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e.doctor@test.dev","password":"E2eTest123!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access'])")
```
نفس الطريقة لباقي الحسابات: `e2e.secretary@test.dev`, `e2e.manager@test.dev`, `e2e.patient4@test.dev`.

### الخطوة 3: شوف قوالب الأشعة المتاحة

```bash
curl -s http://127.0.0.1:8000/api/radiology-templates/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

### الخطوة 4: شوف الـ 4 أوردرات اللي اتزرعت لـ e2e.patient4

```bash
curl -s http://127.0.0.1:8000/api/radiology-orders/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```
هتلاقي فيهم `patient` (ده رقم الـ patient profile بتاع e2e.patient4، احفظه هتحتاجه)، و`id` لكل أوردر، وحالته (`status`).

فلترة بالحالة:
```bash
curl -s "http://127.0.0.1:8000/api/radiology-orders/?status=ORDERED" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
```

### الخطوة 5: اعمل أوردر جديد بنفسك (بالطريقتين)

من قالب (استبدل `<PATIENT_ID>` و `<TEMPLATE_ID>` باللي شفته فوق):
```bash
curl -s -X POST http://127.0.0.1:8000/api/radiology-orders/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"patient": <PATIENT_ID>, "template": <TEMPLATE_ID>, "clinical_reason": "سعال مستمر", "priority": "URGENT"}'
```

بدراسة حرة (من غير قالب):
```bash
curl -s -X POST http://127.0.0.1:8000/api/radiology-orders/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"patient": <PATIENT_ID>, "study_name": "Wrist X-Ray", "clinical_reason": "اشتباه كسر"}'
```

### الخطوة 6: "أكمل" الأوردر (ارفع الصورة) — كسكرتيرة

```bash
curl -s -X POST http://127.0.0.1:8000/api/radiology-orders/<ORDER_ID>/complete/ \
  -H "Authorization: Bearer $SECRETARY_TOKEN" \
  -F "file=@/path/to/any/image.png" \
  -F "description=صورة أشعة صدر"
```
النتيجة: الحالة تبقى `COMPLETED`، وييتعمل `Scan` جديد مربوط بالأوردر ده (تقدر تتأكد منه من `/api/scans/?patient=<PATIENT_ID>`).

### الخطوة 7: اكتب التقرير — كدكتور (أو مدير)

```bash
curl -s -X POST http://127.0.0.1:8000/api/radiology-orders/<ORDER_ID>/report/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"findings": "لا يوجد شذوذ حاد", "impression": "فحص طبيعي"}'
```
الحالة تبقى `REPORTED`. جرب تلغيه بعد كده (`/cancel/`) — المفروض يرفض بخطأ 400 لأنه بقى نهائي.

### الخطوة 8: الغِ أوردر

```bash
curl -s -X POST http://127.0.0.1:8000/api/radiology-orders/<ORDER_ID>/cancel/ \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"reason": "المريض أجّل الكشف"}'
```
شغالة وهو لسه `ORDERED` أو `COMPLETED` بس — مش بعد ما يتعمله `report`.

### الخطوة 9: شوف التنبيهات (كمريض)

```bash
curl -s http://127.0.0.1:8000/api/notifications/ -H "Authorization: Bearer $PATIENT_TOKEN"
```
المفروض تلاقي إشعارات زي "Radiology order created" / "completed" / "report available" / "cancelled".

### الخطوة 10: شوف سجل المراجعة (كمدير)

```bash
curl -s "http://127.0.0.1:8000/api/audit-logs/?search=RadiologyOrder" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
أو من المتصفح: `/manager/audit` وابحث باسم الدراسة (زي "Chest X-Ray").

---

## الطريقة التالتة — تجربة من المتصفح مباشرة (خطوة بخطوة)

كل الخطوات دي **اتجربت فعليًا وشغالة** (تشغيل حقيقي عبر متصفح، مش وصف نظري) — الأسامي والأزرار مطابقة 100% لما هتشوفه على الشاشة.

### الخطوة 0: جهّز البيانات والسيرفر (مرة واحدة، آمن تكرره براحتك)

```bash
cd Backend
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe manage.py seed_radiology_templates
PYTHONPATH="$PWD" ./.venv/Scripts/python.exe manage.py seed_radiology_e2e
```
ده بيجهزلك تلقائي: مريض جاهز (`e2e.patient4@test.dev` — الاسم "Laila Younes") واقف في طابور دكتور `e2e.doctor@test.dev`، **+ 4 أوردرات جاهزين** (واحد في كل حالة: ORDERED / COMPLETED / REPORTED / CANCELLED) — يعني مش محتاج تسجل مريض ولا تحجز ميعاد ولا تعمل تشيك-إن أبدًا.

بعدين شغّل السيرفر لو مش شغال (من روت المشروع، PowerShell):
```powershell
.\dev.ps1 restart
```
افتح `http://localhost:5173/login` — كل الحسابات كلمة سرها `E2eTest123!`.

### الخطوة 1: (دكتور) اعمل أوردر أشعة جديد من شاشة الكشف

1. سجل دخول بـ `e2e.doctor@test.dev`.
2. روح `/doctor/queue`.
3. دوس على الزرار اللي فيه اسم "Laila Younes" — هيكون **"🩻 Open Clinical Encounter"** (لو المريض واقف بالفعل في الطابور) أو **"Call Next Patient"** (لو لسه محدش ناداه).
4. في شاشة الكشف، في القائمة الجانبية (Encounter actions)، دوس **"Order Radiology Study"**.
5. من قايمة "Study template" اختار أي قالب (زي "Chest X-Ray" أو "Knee MRI")، أو اختار **"Custom / free-text study"** واكتب اسم دراسة بنفسك.
6. (اختياري) اكتب "Clinical reason" وغيّر "Priority" لـ Urgent لو حابب.
7. دوس **"Save"** — هتشوف toast اسمه "Radiology order created"، والأوردر الجديد يظهر فورًا تحت "Linked radiology orders" بحالة **Ordered**.

### الخطوة 2: (دكتور) جرب كل حالات الأوردر الـ 4 المزروعة مسبقًا

1. روح `/doctor/patients` (نفس حساب الدكتور).
2. من قايمة اختيار المريض، اختار **"Laila Younes"**.
3. دوس على تبويب **"Radiology"** (جنب تبويب Procedures).
4. هتلاقي 4 صفوف — دوس على كل واحد وجرب:
   - **الصف بحالة Ordered** (Chest X-Ray): دوس عليه → دوس **"Cancel Order"** → اكتب سبب (3 حروف على الأقل) → دوس **"Confirm Cancellation"** → الحالة تتحول لـ **Cancelled**.
   - **الصف بحالة Completed** (Abdominal Ultrasound): دوس عليه → دوس **"Write Report"** → املأ **Findings** و **Impression** → دوس **"Write Report"** تاني للتأكيد → الحالة تتحول لـ **Reported**.
   - **الصف بحالة Reported** (Head CT): دوس عليه → تأكد إنه للقراءة فقط (مفيش أزرار إجراءات خالص) وإن Findings/Impression ظاهرين.
   - **الصف بحالة Cancelled**: دوس عليه → تأكد إن سبب الإلغاء ظاهر ومفيش أزرار إجراءات.

### الخطوة 3: (سكرتيرة) كملي أوردر (رفع الصورة)

1. سجل خروج، وسجل دخول بـ `e2e.secretary@test.dev`.
2. روح `/secretary/radiology` (من القائمة الجانبية: "Radiology Worklist").
3. هتلاقي أي أوردر بحالة Ordered (زي اللي عملته في الخطوة 1، أو اللي اتعمل من seed لو لسه ما اتلغاش).
4. دوس **"Complete Order"** → اختار أي ملف صورة/PDF من جهازك → (اختياري) اكتب وصف → دوس **"Complete Order"** جوه المودال → توست "Order marked as completed" والحالة تتحول لـ **Completed**.

### الخطوة 4: (مريض) شوف طلباتك

1. سجل دخول بـ `e2e.patient4@test.dev`.
2. روح `/patient/radiology` (من القائمة الجانبية: "Radiology").
3. هتشوف كل الأوردرات بتاعتك بحالتها، للقراءة فقط. دوس على أي أوردر Reported وشوف الـ Findings/Impression.

### الخطوة 5: (مدير) اتأكد من سجل المراجعة

1. سجل دخول بـ `e2e.manager@test.dev`.
2. روح `/manager/audit` — دور باسم الدراسة (زي "Chest X-Ray") أو تصفح من غير فلترة، هتلاقي CREATE/UPDATE لكل حاجة عملتها فوق.

> ملحوظة: لو عايز تعيد التجربة من أول وجديد، شغّل `seed_radiology_e2e` تاني — هيجهزلك أي bucket استهلكته (كمّلته/ألغيته) من جديد، من غير ما يكرر حاجة موجودة.
