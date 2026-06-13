"""Render a report dict to PDF (reportlab) or CSV (stdlib)."""
import csv
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _table(rows, col_widths=None):
    t = Table(rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B5FA5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C2CCD6")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F6F9")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def render_report_pdf(report, clinic_name="Clinic") -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title="Clinic Report",
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=16 * mm, rightMargin=16 * mm)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"<b>{clinic_name}</b>", styles["Title"]),
        Paragraph(f"Management Report — period: {report['period']}", styles["Heading2"]),
        Spacer(1, 6 * mm),
    ]

    o = report["overall"]
    story.append(_table([
        ["Total", "Completed", "No-show", "Cancelled", "Avg wait (min)", "New patients"],
        [o["total"], o["completed"], o["no_show"], o["cancelled"],
         report["avg_wait_minutes"], report["new_patients_total"]],
    ]))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Appointments per doctor", styles["Heading3"]))
    rows = [["Doctor", "Total", "Completed", "No-show", "No-show %", "Cancelled"]]
    for d in report["appointments_per_doctor"]:
        rows.append([d["doctor_name"], d["total"], d["completed"], d["no_show"],
                     d["no_show_rate"], d["cancelled"]])
    story.append(_table(rows))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Ratings", styles["Heading3"]))
    rrows = [["Doctor", "Avg rating", "Reviews"]]
    for r in report["ratings"]:
        rrows.append([r["doctor_name"], r["average"], r["count"]])
    story.append(_table(rrows))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Doctor attendance (absence days)", styles["Heading3"]))
    arows = [["Doctor", "Absence days"]]
    for a in report["attendance"]:
        arows.append([a["doctor_name"], a["absence_days"]])
    story.append(_table(arows))

    doc.build(story)
    return buffer.getvalue()


def render_report_csv(report) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Clinic Management Report", f"period={report['period']}"])
    w.writerow([])
    o = report["overall"]
    w.writerow(["Overall: total", "completed", "no_show", "cancelled", "avg_wait_min", "new_patients"])
    w.writerow([o["total"], o["completed"], o["no_show"], o["cancelled"],
                report["avg_wait_minutes"], report["new_patients_total"]])
    w.writerow([])
    w.writerow(["Doctor", "Total", "Completed", "No-show", "No-show %", "Cancelled"])
    for d in report["appointments_per_doctor"]:
        w.writerow([d["doctor_name"], d["total"], d["completed"], d["no_show"],
                    d["no_show_rate"], d["cancelled"]])
    w.writerow([])
    w.writerow(["Doctor", "Avg rating", "Reviews"])
    for r in report["ratings"]:
        w.writerow([r["doctor_name"], r["average"], r["count"]])
    w.writerow([])
    w.writerow(["Doctor", "Absence days"])
    for a in report["attendance"]:
        w.writerow([a["doctor_name"], a["absence_days"]])
    return out.getvalue()
