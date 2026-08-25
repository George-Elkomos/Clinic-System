"""format_when_bilingual must render notification timestamps in 12-hour
AM/PM (English) / ص-م (Arabic) form -- never 24-hour military time. See
apps/core/text.py.
"""
from datetime import datetime

import pytest

from apps.core.text import format_when_bilingual


@pytest.mark.parametrize(
    "hour, minute, expected_en_suffix, expected_ar_suffix",
    [
        (0, 0, "12:00 AM", "12:00 ص"),      # midnight
        (9, 5, "9:05 AM", "9:05 ص"),
        (12, 0, "12:00 PM", "12:00 م"),     # noon
        (15, 20, "3:20 PM", "3:20 م"),      # the reported 15:20 case
        (23, 45, "11:45 PM", "11:45 م"),
    ],
)
def test_format_when_bilingual_uses_12_hour_clock(hour, minute, expected_en_suffix, expected_ar_suffix):
    dt = datetime(2026, 8, 20, hour, minute)
    en, ar = format_when_bilingual(dt)
    assert en.endswith(expected_en_suffix)
    # ar is wrapped in FSI/PDI bidi-isolate marks (see bidi_isolate), so check
    # containment rather than an exact suffix match.
    assert expected_ar_suffix in ar
