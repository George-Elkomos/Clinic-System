"""format_when_bilingual/format_when_short_bilingual must render notification
timestamps in 12-hour AM/PM (English) / ص-م (Arabic) form -- never 24-hour
military time -- and in the clinic's local time (Africa/Cairo), not the raw
UTC value DateTimeField returns. See apps/core/text.py.
"""
from datetime import datetime, timezone as dt_timezone

import pytest
from django.utils import timezone

from apps.core.text import format_when_bilingual, format_when_short_bilingual


def _cairo(*args):
    """An aware datetime expressed directly in the clinic's local zone (as
    opposed to a raw UTC value from the DB) -- lets the 12-hour-formatting
    tests below assert on the hour/minute they pass in without also having
    to account for the UTC conversion covered separately."""
    return timezone.make_aware(datetime(*args))


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
    dt = _cairo(2026, 8, 20, hour, minute)
    en, ar = format_when_bilingual(dt)
    assert en.endswith(expected_en_suffix)
    # ar is wrapped in FSI/PDI bidi-isolate marks (see bidi_isolate), so check
    # containment rather than an exact suffix match.
    assert expected_ar_suffix in ar


def test_format_when_bilingual_converts_utc_to_local_time():
    # A DB-fetched DateTimeField comes back UTC-aware; formatting it must
    # show the clinic's local (Africa/Cairo) clock time, not the raw UTC
    # hour -- regression test for the bug caught while verifying the
    # secretary booking-notification feature (the raw UTC hour was showing
    # up in notification text, hours off from the real appointment time).
    dt_utc = datetime(2026, 8, 27, 6, 35, tzinfo=dt_timezone.utc)
    en, ar = format_when_bilingual(dt_utc)
    local = timezone.localtime(dt_utc)
    assert str(local.hour) != "6"  # sanity: Cairo is not UTC+0 on this date
    assert f"{local.hour % 12 or 12}:{local.minute:02d}" in en


def test_format_when_short_bilingual_matches_expected_template():
    # 26 Aug 2026, 16:30 (Cairo local) -> "26 Aug, 04:30 PM" / "26 أغسطس، 04:30 م"
    dt = _cairo(2026, 8, 26, 16, 30)
    en, ar = format_when_short_bilingual(dt)
    assert en == "26 Aug, 04:30 PM"
    assert "26 أغسطس، 04:30 م" in ar
    assert "2026" not in en  # no year -- distinct from format_when_bilingual


def test_format_when_short_bilingual_converts_utc_to_local_time():
    dt_utc = datetime(2026, 8, 27, 6, 35, tzinfo=dt_timezone.utc)
    en, _ar = format_when_short_bilingual(dt_utc)
    local = timezone.localtime(dt_utc)
    assert f"{local.hour % 12 or 12:02d}:{local.minute:02d}" in en


@pytest.mark.parametrize(
    "hour, minute, expected_en_suffix, expected_ar_suffix",
    [
        (0, 0, "12:00 AM", "12:00 ص"),      # midnight
        (9, 5, "09:05 AM", "09:05 ص"),  # hour zero-padded, unlike the long form
        (12, 0, "12:00 PM", "12:00 م"),     # noon
    ],
)
def test_format_when_short_bilingual_zero_pads_hour(hour, minute, expected_en_suffix, expected_ar_suffix):
    dt = _cairo(2026, 8, 5, hour, minute)
    en, ar = format_when_short_bilingual(dt)
    assert en.endswith(expected_en_suffix)
    assert expected_ar_suffix in ar
