#!/usr/bin/env python3
"""Unit tests for the search query parser."""

import sys
import os
import unittest
from datetime import datetime, timedelta

# Ensure the server directory is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from search_parser import parse_search_query, has_filters, _parse_date


class TestParseSearchQuery(unittest.TestCase):
    """Tests for parse_search_query()."""

    # ---- Plain text (no filters) ----

    def test_plain_text(self):
        result = parse_search_query('hello world')
        self.assertEqual(result['text'], 'hello world')
        self.assertFalse(has_filters(result))

    def test_empty_string(self):
        result = parse_search_query('')
        self.assertEqual(result['text'], '')
        self.assertFalse(has_filters(result))

    # ---- Single filters ----

    def test_from_filter(self):
        result = parse_search_query('from:alice')
        self.assertEqual(result['from'], ['alice'])
        self.assertEqual(result['text'], '')

    def test_mentions_filter(self):
        result = parse_search_query('mentions:bob')
        self.assertEqual(result['mentions'], ['bob'])

    def test_in_filter(self):
        result = parse_search_query('in:general')
        self.assertEqual(result['in'], ['general'])

    def test_in_dm(self):
        result = parse_search_query('in:dm')
        self.assertEqual(result['in'], ['dm'])

    def test_has_file(self):
        result = parse_search_query('has:file')
        self.assertEqual(result['has'], ['file'])

    def test_has_link(self):
        result = parse_search_query('has:link')
        self.assertEqual(result['has'], ['link'])

    def test_has_image(self):
        result = parse_search_query('has:image')
        self.assertEqual(result['has'], ['image'])

    def test_has_video(self):
        result = parse_search_query('has:video')
        self.assertEqual(result['has'], ['video'])

    def test_has_unknown_value(self):
        """Unknown has: value should be left in free text."""
        result = parse_search_query('has:banana')
        self.assertEqual(result['has'], [])
        self.assertIn('has:banana', result['text'])

    def test_is_pinned(self):
        result = parse_search_query('is:pinned')
        self.assertEqual(result['is'], ['pinned'])

    def test_is_unknown(self):
        result = parse_search_query('is:starred')
        self.assertEqual(result['is'], [])
        self.assertIn('is:starred', result['text'])

    def test_before_date(self):
        result = parse_search_query('before:2025-06-01')
        self.assertEqual(result['before'], '2025-06-01')

    def test_after_date(self):
        result = parse_search_query('after:2025-01-01')
        self.assertEqual(result['after'], '2025-01-01')

    def test_during_date(self):
        result = parse_search_query('during:2025-03-15')
        self.assertEqual(result['during'], '2025-03-15')

    def test_before_invalid_date(self):
        """Invalid date should be left in free text."""
        result = parse_search_query('before:not-a-date')
        self.assertIsNone(result['before'])
        self.assertIn('before:not-a-date', result['text'])

    # ---- Relative dates ----

    def test_before_7d(self):
        result = parse_search_query('before:7d')
        expected = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        self.assertEqual(result['before'], expected)

    def test_after_today(self):
        result = parse_search_query('after:today')
        self.assertEqual(result['after'], datetime.now().strftime('%Y-%m-%d'))

    def test_during_yesterday(self):
        result = parse_search_query('during:yesterday')
        expected = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        self.assertEqual(result['during'], expected)

    # ---- Quoted values ----

    def test_from_quoted(self):
        result = parse_search_query('from:"User Name"')
        self.assertEqual(result['from'], ['User Name'])

    def test_in_quoted(self):
        result = parse_search_query('in:"my channel"')
        self.assertEqual(result['in'], ['my channel'])

    # ---- Combined filters ----

    def test_multiple_from(self):
        result = parse_search_query('from:alice from:bob')
        self.assertIn('alice', result['from'])
        self.assertIn('bob', result['from'])

    def test_mixed_filters_and_text(self):
        result = parse_search_query('from:alice has:file meeting notes')
        self.assertEqual(result['from'], ['alice'])
        self.assertEqual(result['has'], ['file'])
        self.assertIn('meeting', result['text'])
        self.assertIn('notes', result['text'])

    def test_all_filters(self):
        q = 'from:alice mentions:bob in:general has:image before:2025-12-01 after:2025-01-01 is:pinned hello'
        result = parse_search_query(q)
        self.assertEqual(result['from'], ['alice'])
        self.assertEqual(result['mentions'], ['bob'])
        self.assertEqual(result['in'], ['general'])
        self.assertEqual(result['has'], ['image'])
        self.assertEqual(result['before'], '2025-12-01')
        self.assertEqual(result['after'], '2025-01-01')
        self.assertEqual(result['is'], ['pinned'])
        self.assertIn('hello', result['text'])
        self.assertTrue(has_filters(result))

    # ---- Duplicate values ----

    def test_duplicate_from_deduplicated(self):
        result = parse_search_query('from:alice from:alice')
        self.assertEqual(result['from'], ['alice'])

    # ---- Case insensitivity of keys ----

    def test_case_insensitive_keys(self):
        result = parse_search_query('FROM:alice HAS:File')
        self.assertEqual(result['from'], ['alice'])
        self.assertEqual(result['has'], ['file'])

    # ---- has_filters helper ----

    def test_has_filters_true(self):
        self.assertTrue(has_filters(parse_search_query('from:alice')))
        self.assertTrue(has_filters(parse_search_query('is:pinned')))
        self.assertTrue(has_filters(parse_search_query('before:2025-01-01')))

    def test_has_filters_false(self):
        self.assertFalse(has_filters(parse_search_query('hello world')))
        self.assertFalse(has_filters(parse_search_query('')))


class TestParseDate(unittest.TestCase):
    """Tests for _parse_date()."""

    def test_iso_date(self):
        self.assertEqual(_parse_date('2025-03-15'), '2025-03-15')

    def test_today(self):
        self.assertEqual(_parse_date('today'), datetime.now().strftime('%Y-%m-%d'))

    def test_yesterday(self):
        expected = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        self.assertEqual(_parse_date('yesterday'), expected)

    def test_relative_days(self):
        expected = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        self.assertEqual(_parse_date('30d'), expected)

    def test_invalid(self):
        self.assertIsNone(_parse_date('foobar'))
        self.assertIsNone(_parse_date('2025/03/15'))


if __name__ == '__main__':
    unittest.main()
