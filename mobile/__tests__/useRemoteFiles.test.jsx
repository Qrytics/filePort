/**
 * Tests for the useRemoteFiles hook.
 *
 * The Supabase client is fully mocked so these tests run without any network
 * or database connection.
 */

// React / react-native setup is handled by the react-native jest preset.
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { useRemoteFiles } from '../src/hooks/useRemoteFiles';

// ── Supabase mock factory ──────────────────────────────────────────────────

/**
 * Build a chainable Supabase mock that ultimately resolves with `{ data, error }`.
 * Each query builder method (from, select, like, eq, order, single) returns `this`.
 */
function makeSupabaseMock({ data = [], error = null } = {}) {
  const builder = {
    data,
    error,
    select: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: data[0] ?? null, error }),
    // When awaited, the query builder itself resolves
    then: (resolve) => resolve({ data, error }),
  };

  return {
    from: jest.fn().mockReturnValue(builder),
    _builder: builder,
  };
}

// ── listDirectory ──────────────────────────────────────────────────────────

describe('useRemoteFiles — listDirectory', () => {
  test('returns direct children of the requested directory', async () => {
    const mockData = [
      { path: '/home/alice/notes.txt', name: 'notes.txt', is_directory: false, file_size: 100 },
      { path: '/home/alice/docs', name: 'docs', is_directory: true, file_size: 0 },
      // Grandchild — should be filtered out by getDirectChildren
      { path: '/home/alice/docs/report.md', name: 'report.md', is_directory: false, file_size: 200 },
    ];

    const supabase = makeSupabaseMock({ data: mockData });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    let entries;
    await act(async () => {
      entries = await result.current.listDirectory('/home/alice');
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toContain('notes.txt');
    expect(entries.map((e) => e.name)).toContain('docs');
    expect(entries.map((e) => e.name)).not.toContain('report.md');
  });

  test('uses a "like" pattern that matches the directory prefix', async () => {
    const supabase = makeSupabaseMock({ data: [] });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    await act(async () => {
      await result.current.listDirectory('/home/alice');
    });

    expect(supabase._builder.like).toHaveBeenCalledWith('path', '/home/alice/%');
  });

  test('uses "/%%" pattern for root directory', async () => {
    const supabase = makeSupabaseMock({ data: [] });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    await act(async () => {
      await result.current.listDirectory('/');
    });

    expect(supabase._builder.like).toHaveBeenCalledWith('path', '/%');
  });

  test('returns empty array when there are no children', async () => {
    const supabase = makeSupabaseMock({ data: [] });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    let entries;
    await act(async () => {
      entries = await result.current.listDirectory('/empty-dir');
    });

    expect(entries).toEqual([]);
  });

  test('throws an Error when Supabase returns an error', async () => {
    const supabase = makeSupabaseMock({ error: { message: 'Network failure' } });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    await expect(
      act(async () => {
        await result.current.listDirectory('/home/alice');
      })
    ).rejects.toThrow('Network failure');
  });
});

// ── checkDirectory ─────────────────────────────────────────────────────────

describe('useRemoteFiles — checkDirectory', () => {
  test('returns true for an existing directory', async () => {
    const supabase = makeSupabaseMock({
      data: [{ is_directory: true }],
    });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    let isDir;
    await act(async () => {
      isDir = await result.current.checkDirectory('/home/alice');
    });

    expect(isDir).toBe(true);
  });

  test('returns false for an existing file (not a directory)', async () => {
    const supabase = makeSupabaseMock({
      data: [{ is_directory: false }],
    });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    let isDir;
    await act(async () => {
      isDir = await result.current.checkDirectory('/home/alice/notes.txt');
    });

    expect(isDir).toBe(false);
  });

  test('returns false when path is not found (PGRST116)', async () => {
    const supabase = makeSupabaseMock({
      data: [],
      error: { message: 'No rows', code: 'PGRST116' },
    });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    let isDir;
    await act(async () => {
      isDir = await result.current.checkDirectory('/nonexistent');
    });

    expect(isDir).toBe(false);
  });

  test('throws for non-PGRST116 Supabase errors', async () => {
    const supabase = makeSupabaseMock({
      data: [],
      error: { message: 'Unexpected DB error', code: '500' },
    });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    await expect(
      act(async () => {
        await result.current.checkDirectory('/home/alice');
      })
    ).rejects.toThrow('Unexpected DB error');
  });

  test('queries the correct path with eq filter', async () => {
    const supabase = makeSupabaseMock({
      data: [{ is_directory: true }],
    });
    const { result } = renderHook(() => useRemoteFiles(supabase));

    await act(async () => {
      await result.current.checkDirectory('/home/alice');
    });

    expect(supabase._builder.eq).toHaveBeenCalledWith('path', '/home/alice');
  });
});
