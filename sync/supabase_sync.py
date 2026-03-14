"""
supabase_sync.py — filePort Supabase pending_sync poller.

Polls the Supabase `remote_files` table every POLL_INTERVAL_SECONDS seconds.
For every row whose `pending_sync` flag is true it:

  1. Reads the `content` column.
  2. Overwrites (or creates) the local file at `path` with that content.
  3. Clears `pending_sync` and stamps `last_modified_local` in the database.

Configuration (environment variables or a .env file next to this script):
  SUPABASE_URL           – https://<project-ref>.supabase.co
  SUPABASE_SERVICE_KEY   – service-role key (bypasses RLS; never expose publicly)
  POLL_INTERVAL_SECONDS  – polling cadence in seconds (default: 60)

Usage:
  python supabase_sync.py

Exit codes:
  1  – missing required environment variable
"""

from __future__ import annotations

import logging
import os
import pathlib
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv is optional; env vars may be set externally.

from supabase import create_client, Client

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [sync] %(levelname)s %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%SZ',
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

TABLE = 'remote_files'
DEFAULT_POLL_INTERVAL = 60  # seconds


# ── Core functions (each unit-testable in isolation) ──────────────────────────

def fetch_pending(client: Client) -> list[dict[str, Any]]:
    """Return all remote_files rows where pending_sync is true.

    Raises:
        RuntimeError: if the Supabase query fails.
    """
    response = (
        client.table(TABLE)
        .select('path, content, is_directory')
        .eq('pending_sync', True)
        .execute()
    )
    return response.data or []


def write_file(file_path: str, content: str) -> None:
    """Overwrite (or create) the local file at *file_path* with *content*.

    Parent directories are created automatically.

    Raises:
        OSError: if the file cannot be written.
    """
    p = pathlib.Path(file_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')


def clear_pending(client: Client, file_path: str, now: str) -> None:
    """Clear the pending_sync flag and update last_modified_local for one row.

    Args:
        client:    Supabase client.
        file_path: Absolute path (the primary key used to locate the row).
        now:       ISO-8601 UTC timestamp to record as last_modified_local.

    Raises:
        RuntimeError: if the Supabase update fails.
    """
    client.table(TABLE).update(
        {'pending_sync': False, 'last_modified_local': now}
    ).eq('path', file_path).execute()


def process_row(client: Client, row: dict[str, Any]) -> dict[str, Any]:
    """Apply one pending row to the local filesystem and clear its flag.

    Returns a result dict::
        {
            'path':   str,
            'status': 'applied' | 'skipped' | 'error',
            'reason': str | None,  # only present for 'skipped'/'error'
        }
    """
    file_path = row.get('path', '')

    if row.get('is_directory'):
        # For directory entries just ensure the local path exists.
        try:
            pathlib.Path(file_path).mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return {'path': file_path, 'status': 'error', 'reason': str(exc)}
        try:
            now = datetime.now(timezone.utc).isoformat()
            clear_pending(client, file_path, now)
        except Exception as exc:  # noqa: BLE001
            return {
                'path': file_path,
                'status': 'error',
                'reason': f'Directory created but DB update failed: {exc}',
            }
        return {'path': file_path, 'status': 'applied'}

    content = row.get('content') or ''

    try:
        write_file(file_path, content)
    except OSError as exc:
        return {
            'path': file_path,
            'status': 'error',
            'reason': f'Cannot write file: {exc}',
        }

    now = datetime.now(timezone.utc).isoformat()
    try:
        clear_pending(client, file_path, now)
    except Exception as exc:  # noqa: BLE001
        return {
            'path': file_path,
            'status': 'error',
            'reason': f'File written but DB update failed: {exc}',
        }

    logger.info('✔ Applied mobile changes to "%s"', file_path)
    return {'path': file_path, 'status': 'applied'}


def run_sync_cycle(client: Client) -> list[dict[str, Any]]:
    """Run one complete sync cycle.

    Fetches all pending rows, processes each one, and returns a list of result
    dicts as produced by :func:`process_row`.

    A failure to fetch rows is logged but does not raise so the polling loop
    can keep running.
    """
    logger.info('Checking for pending mobile changes…')

    try:
        pending = fetch_pending(client)
    except Exception as exc:  # noqa: BLE001
        logger.error('Failed to fetch pending rows: %s', exc)
        return []

    if not pending:
        logger.info('No pending changes.')
        return []

    logger.info('Found %d pending record(s).', len(pending))

    results: list[dict[str, Any]] = []
    for row in pending:
        result = process_row(client, row)
        results.append(result)
        if result['status'] == 'error':
            logger.error('Error processing "%s": %s', result['path'], result.get('reason'))

    applied = sum(1 for r in results if r['status'] == 'applied')
    skipped = sum(1 for r in results if r['status'] == 'skipped')
    errors  = sum(1 for r in results if r['status'] == 'error')
    logger.info('Done. Applied: %d, Skipped: %d, Errors: %d', applied, skipped, errors)

    return results


# ── Entry point ───────────────────────────────────────────────────────────────

def _build_client() -> Client:
    """Create and return a Supabase client from environment variables."""
    url = os.environ.get('SUPABASE_URL', '').strip()
    key = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()

    if not url:
        logger.error('SUPABASE_URL is not set. Copy .env.example to .env and fill it in.')
        sys.exit(1)
    if not key:
        logger.error('SUPABASE_SERVICE_KEY is not set. Copy .env.example to .env and fill it in.')
        sys.exit(1)

    return create_client(url, key)


def main() -> None:  # pragma: no cover — entry-point; sleep/signal loop not unit-testable
    """Poll Supabase for pending_sync rows and apply them to the local disk.

    The core sync logic lives in :func:`run_sync_cycle`, which *is* fully
    unit-tested.  This function only wires together the event loop, signal
    handlers, and the configurable sleep interval.
    """
    poll_interval = int(os.environ.get('POLL_INTERVAL_SECONDS', DEFAULT_POLL_INTERVAL))
    client = _build_client()

    logger.info('filePort Supabase sync poller started (interval: %ds).', poll_interval)

    # Graceful shutdown on SIGINT / SIGTERM.
    def _shutdown(signum: int, frame: object) -> None:
        logger.info('Shutting down (signal %d).', signum)
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while True:
        run_sync_cycle(client)
        time.sleep(poll_interval)


if __name__ == '__main__':
    main()
