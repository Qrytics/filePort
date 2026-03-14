"""
Tests for supabase_sync.py.

The Supabase client is fully mocked so these tests run without any network
or database connection.  Temporary directories are used for all filesystem
operations so the real working tree is never touched.
"""
from __future__ import annotations

import pathlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# Make the sync package importable without installing it.
import sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from supabase_sync import (
    clear_pending,
    fetch_pending,
    process_row,
    run_sync_cycle,
    write_file,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def make_client(rows=None, update_error=None):
    """Return a minimal mock Supabase client.

    Supports the chained call patterns used by supabase_sync.py::

        client.table(T).select(cols).eq(field, val).execute()  → data=rows
        client.table(T).update(fields).eq(field, val).execute()  → may raise

    Exposed attributes for assertions::
        client._table_proxy   – object returned by client.table(...)
        client._select_eq     – object returned by .select().eq(...)   (inject errors here)
        client._update_builder – object returned by .update(...)
        client._update_eq     – object returned by .update().eq(...)
    """
    rows = rows or []

    # SELECT chain: .table().select().eq().execute()
    select_eq = MagicMock()
    select_eq.execute.return_value = SimpleNamespace(data=rows)

    select_builder = MagicMock()
    select_builder.eq.return_value = select_eq

    # UPDATE chain: .table().update().eq().execute()
    update_eq = MagicMock()
    if update_error:
        update_eq.execute.side_effect = RuntimeError(update_error)
    else:
        update_eq.execute.return_value = SimpleNamespace(data=None)

    update_builder = MagicMock()
    update_builder.eq.return_value = update_eq

    # Table proxy: object returned by client.table(TABLE)
    table_proxy = MagicMock()
    table_proxy.select.return_value = select_builder
    table_proxy.update.return_value = update_builder

    client = MagicMock()
    client.table.return_value = table_proxy

    # Expose for test assertions.
    client._table_proxy = table_proxy
    client._select_eq = select_eq
    client._update_builder = update_builder
    client._update_eq = update_eq

    return client


# ── fetch_pending ─────────────────────────────────────────────────────────────


class TestFetchPending:
    def test_returns_rows_from_supabase(self):
        rows = [
            {'path': '/a.txt', 'content': 'hello', 'is_directory': False},
            {'path': '/b.txt', 'content': 'world', 'is_directory': False},
        ]
        client = make_client(rows=rows)
        result = fetch_pending(client)
        assert result == rows

    def test_filters_by_pending_sync_true(self):
        client = make_client(rows=[])
        fetch_pending(client)
        # .select().eq('pending_sync', True) is the filter
        client._table_proxy.select.return_value.eq.assert_called_once_with('pending_sync', True)

    def test_returns_empty_list_when_no_pending_rows(self):
        client = make_client(rows=[])
        result = fetch_pending(client)
        assert result == []

    def test_returns_empty_list_when_data_is_none(self):
        """Supabase may return data=None; we must not fail."""
        client = make_client(rows=[])
        client._select_eq.execute.return_value = SimpleNamespace(data=None)
        result = fetch_pending(client)
        assert result == []

    def test_raises_on_supabase_error(self):
        client = make_client()
        client._select_eq.execute.side_effect = RuntimeError('Network error')
        with pytest.raises(RuntimeError, match='Network error'):
            fetch_pending(client)


# ── write_file ────────────────────────────────────────────────────────────────


class TestWriteFile:
    def test_writes_content_to_existing_directory(self, tmp_path):
        target = tmp_path / 'notes.txt'
        write_file(str(target), 'Hello, world!')
        assert target.read_text(encoding='utf-8') == 'Hello, world!'

    def test_creates_parent_directories(self, tmp_path):
        target = tmp_path / 'nested' / 'deep' / 'note.md'
        write_file(str(target), '# Heading')
        assert target.exists()
        assert target.read_text(encoding='utf-8') == '# Heading'

    def test_overwrites_existing_content(self, tmp_path):
        target = tmp_path / 'file.txt'
        target.write_text('old content', encoding='utf-8')
        write_file(str(target), 'new content')
        assert target.read_text(encoding='utf-8') == 'new content'

    def test_writes_empty_string(self, tmp_path):
        target = tmp_path / 'empty.txt'
        write_file(str(target), '')
        assert target.read_text(encoding='utf-8') == ''

    def test_writes_unicode_content(self, tmp_path):
        target = tmp_path / 'unicode.txt'
        write_file(str(target), '日本語テスト 🚀')
        assert target.read_text(encoding='utf-8') == '日本語テスト 🚀'


# ── clear_pending ─────────────────────────────────────────────────────────────


class TestClearPending:
    def test_calls_update_with_correct_fields(self):
        client = make_client()
        clear_pending(client, '/a.txt', '2024-06-20T12:00:00+00:00')
        # .table().update({...}) — check the payload passed to update()
        client._table_proxy.update.assert_called_once_with(
            {'pending_sync': False, 'last_modified_local': '2024-06-20T12:00:00+00:00'}
        )

    def test_filters_by_path(self):
        client = make_client()
        clear_pending(client, '/home/alice/notes.txt', '2024-06-20T12:00:00+00:00')
        # .table().update({...}).eq('path', ...) — check the path filter
        client._update_builder.eq.assert_called_once_with('path', '/home/alice/notes.txt')

    def test_raises_when_update_fails(self):
        client = make_client(update_error='DB write conflict')
        with pytest.raises(RuntimeError, match='DB write conflict'):
            clear_pending(client, '/a.txt', '2024-06-20T12:00:00+00:00')


# ── process_row ───────────────────────────────────────────────────────────────


class TestProcessRow:
    def test_applies_content_to_new_local_file(self, tmp_path):
        target = tmp_path / 'hello.txt'
        row = {'path': str(target), 'content': 'Hello from mobile!', 'is_directory': False}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'applied'
        assert target.read_text(encoding='utf-8') == 'Hello from mobile!'

    def test_overwrites_existing_file(self, tmp_path):
        target = tmp_path / 'existing.txt'
        target.write_text('stale', encoding='utf-8')
        row = {'path': str(target), 'content': 'updated', 'is_directory': False}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'applied'
        assert target.read_text(encoding='utf-8') == 'updated'

    def test_writes_empty_content_when_content_is_none(self, tmp_path):
        target = tmp_path / 'empty.txt'
        row = {'path': str(target), 'content': None, 'is_directory': False}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'applied'
        assert target.read_text(encoding='utf-8') == ''

    def test_creates_parent_directories(self, tmp_path):
        target = tmp_path / 'a' / 'b' / 'c.txt'
        row = {'path': str(target), 'content': 'deep', 'is_directory': False}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'applied'
        assert target.read_text(encoding='utf-8') == 'deep'

    def test_clears_pending_sync_after_writing(self, tmp_path):
        target = tmp_path / 'f.txt'
        row = {'path': str(target), 'content': 'x', 'is_directory': False}
        client = make_client()
        process_row(client, row)
        # Verify that update() was called and included the correct fields
        client._table_proxy.update.assert_called_once()
        update_payload = client._table_proxy.update.call_args[0][0]
        assert update_payload['pending_sync'] is False
        assert 'last_modified_local' in update_payload

    def test_error_status_when_path_is_unwritable(self, tmp_path):
        # Use a path inside a non-writable directory.
        locked = tmp_path / 'locked'
        locked.mkdir()
        locked.chmod(0o555)
        target = locked / 'sub' / 'file.txt'
        row = {'path': str(target), 'content': 'x', 'is_directory': False}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'error'
        assert 'Cannot write file' in result['reason']
        locked.chmod(0o755)  # restore so cleanup works

    def test_error_status_when_db_update_fails(self, tmp_path):
        target = tmp_path / 'ok.txt'
        row = {'path': str(target), 'content': 'x', 'is_directory': False}
        client = make_client(update_error='Connection lost')
        result = process_row(client, row)
        assert result['status'] == 'error'
        assert 'DB update failed' in result['reason']
        # File should still have been written despite the DB error.
        assert target.read_text(encoding='utf-8') == 'x'

    def test_creates_directory_entry(self, tmp_path):
        target = tmp_path / 'new-folder'
        row = {'path': str(target), 'content': '', 'is_directory': True}
        client = make_client()
        result = process_row(client, row)
        assert result['status'] == 'applied'
        assert target.is_dir()


# ── run_sync_cycle ────────────────────────────────────────────────────────────


class TestRunSyncCycle:
    def test_returns_empty_list_when_no_pending_rows(self):
        client = make_client(rows=[])
        results = run_sync_cycle(client)
        assert results == []

    def test_returns_empty_list_on_fetch_error(self):
        client = make_client()
        client._select_eq.execute.side_effect = RuntimeError('network')
        results = run_sync_cycle(client)
        assert results == []

    def test_processes_all_pending_rows(self, tmp_path):
        file1 = tmp_path / 'a.txt'
        file2 = tmp_path / 'b.txt'
        rows = [
            {'path': str(file1), 'content': 'AAA', 'is_directory': False},
            {'path': str(file2), 'content': 'BBB', 'is_directory': False},
        ]
        client = make_client(rows=rows)
        results = run_sync_cycle(client)
        assert len(results) == 2
        assert all(r['status'] == 'applied' for r in results)
        assert file1.read_text(encoding='utf-8') == 'AAA'
        assert file2.read_text(encoding='utf-8') == 'BBB'

    def test_continues_processing_after_a_row_error(self, tmp_path):
        good = tmp_path / 'good.txt'
        # Make the bad row point at an invalid path (impossible to write).
        rows = [
            {'path': '/proc/fileport_cannot_write_here.txt', 'content': 'bad', 'is_directory': False},
            {'path': str(good), 'content': 'good', 'is_directory': False},
        ]
        client = make_client(rows=rows)
        results = run_sync_cycle(client)
        assert results[0]['status'] == 'error'
        assert results[1]['status'] == 'applied'
        assert good.read_text(encoding='utf-8') == 'good'
