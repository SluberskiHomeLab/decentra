"""
Search query parser for Decentra rich search filters.

Supports Discord-style filter operators:
  from:username        - Messages from a specific user
  mentions:username    - Messages mentioning a specific user
  in:channel-name      - Messages in a specific channel (or "dm" for DMs only)
  has:file|attachment|link|image|video|embed|audio - Messages containing specific media
  before:YYYY-MM-DD    - Messages before a date
  after:YYYY-MM-DD     - Messages after a date
  during:YYYY-MM-DD    - Messages on a specific date
  is:pinned            - Pinned messages

Multiple values for the same key are ORed (e.g., from:alice from:bob).
Different filter types are ANDed.
Unrecognised tokens remain in the free-text portion.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, Optional, Any

# Recognised filter keys and their allowed values (None = any value)
KNOWN_FILTERS = {
    'from': None,
    'mentions': None,
    'in': None,
    'has': {'file', 'attachment', 'link', 'image', 'video', 'embed', 'audio'},
    'before': None,
    'after': None,
    'during': None,
    'is': {'pinned'},
}

# Pattern to match key:value or key:"quoted value" tokens
_FILTER_RE = re.compile(
    r'(?P<key>from|mentions|in|has|before|after|during|is)'
    r':'
    r'(?:"(?P<qval>[^"]+)"|(?P<val>\S+))',
    re.IGNORECASE,
)


def parse_search_query(raw: str) -> Dict[str, Any]:
    """Parse a raw search string into structured filters + remaining free text.

    Returns dict with:
      text    - remaining free-text query (str)
      from    - list of usernames
      mentions - list of usernames
      in      - list of channel / context names
      has     - list of media types
      before  - ISO date string or None
      after   - ISO date string or None
      during  - ISO date string or None
      is      - list of flags (e.g. ['pinned'])
    """
    result: Dict[str, Any] = {
        'text': '',
        'from': [],
        'mentions': [],
        'in': [],
        'has': [],
        'before': None,
        'after': None,
        'during': None,
        'is': [],
    }

    # We'll walk through tokens (respecting quoted strings).
    # A token that matches key:value is extracted as a filter; everything else is free text.
    remaining_parts: list[str] = []

    # Split respecting quoted sections: we use a regex that tokenises on spaces
    # but keeps "quoted strings" together with the preceding key:
    token_re = re.compile(
        r'(?:from|mentions|in|has|before|after|during|is):"[^"]*"'
        r'|'
        r'\S+',
        re.IGNORECASE,
    )

    for tok in token_re.findall(raw):
        m = _FILTER_RE.fullmatch(tok)
        if not m:
            remaining_parts.append(tok)
            continue

        key = m.group('key').lower()
        value = (m.group('qval') or m.group('val') or '').strip()

        if not value:
            remaining_parts.append(tok)
            continue

        allowed = KNOWN_FILTERS.get(key)
        if allowed is not None and value.lower() not in allowed:
            remaining_parts.append(tok)
            continue

        if key in ('before', 'after', 'during'):
            parsed_date = _parse_date(value)
            if parsed_date is None:
                remaining_parts.append(tok)
                continue
            result[key] = parsed_date
        elif key in ('from', 'mentions', 'in', 'has', 'is'):
            val_lower = value.lower() if key in ('has', 'is') else value
            if val_lower not in result[key]:
                result[key].append(val_lower)

    result['text'] = ' '.join(remaining_parts).strip()
    return result


def _parse_date(value: str) -> Optional[str]:
    """Try to parse a date string into ISO format (YYYY-MM-DD).

    Accepts:
      - YYYY-MM-DD
      - today, yesterday
      - Nd (e.g. 7d = 7 days ago)
    """
    value_lower = value.lower().strip()

    if value_lower == 'today':
        return datetime.now().strftime('%Y-%m-%d')
    if value_lower == 'yesterday':
        return (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    # Relative days: 7d, 30d etc.
    rel_match = re.match(r'^(\d+)d$', value_lower)
    if rel_match:
        days = int(rel_match.group(1))
        return (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    # ISO date
    try:
        dt = datetime.strptime(value_lower, '%Y-%m-%d')
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        pass

    return None


def has_filters(parsed: Dict[str, Any]) -> bool:
    """Return True if the parsed query contains any active filter besides free text."""
    for key in ('from', 'mentions', 'in', 'has', 'is'):
        if parsed.get(key):
            return True
    for key in ('before', 'after', 'during'):
        if parsed.get(key) is not None:
            return True
    return False
