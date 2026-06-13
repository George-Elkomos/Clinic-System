"""Render a printable prescription PDF with reportlab (pure-Python)."""
from io import BytesIO

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def render_prescription_pdf(prescription) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=20 * mm, bottomMargin=20 * mm,
        leftMargin=20 * mm, rightMargin=20 * mm,
        title=f"Prescription #{prescription.pk}",
    )
    styles = getSampleStyleSheet()
    story = []

    clinic = getattr(settings, "CLINIC_NAME", "Clinic")
    story.append(Paragraph(f"<b>{clinic}</b>", styles["Title"]))
    story.append(Paragraph("Prescription", styles["Heading2"]))
    story.append(Spacer(1, 8 * mm))

    doctor = prescription.doctor
    patient = prescription.patient
    doctor_name = str(doctor) if doctor else "—"
    patient_name = patient.user.get_full_name() or patient.user.email

    header = [
        ["Doctor:", doctor_name],
        ["Patient:", patient_name],
        ["Issued:", prescription.issued_date.strftime("%d %b %Y")],
        ["Status:", prescription.get_status_display()],
    ]
    header_table = Table(header, colWidths=[35 * mm, 120 * mm])
    header_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 8 * mm))

    rows = [["Medication", "Dosage", "Frequency", "Duration", "Instructions"]]
    for item in prescription.items.all():
        rows.append([
            item.drug_name, item.dosage, item.frequency, item.duration,
            item.instructions,
        ])
    if len(rows) == 1:
        rows.append(["—", "", "", "", ""])

    items_table = Table(rows, colWidths=[42 * mm, 25 * mm, 30 * mm, 25 * mm, 33 * mm])
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B5FA5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C2CCD6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F6F9")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(items_table)

    if prescription.notes:
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph(f"<b>Notes:</b> {prescription.notes}", styles["Normal"]))

    doc.build(story)
    return buffer.getvalue()
