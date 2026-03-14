/**
 * Tests for pathUtils.js — pure functions, no mocking required.
 */

const { normalizePath, resolvePath, getDirectChildren } = require('../src/utils/pathUtils');

// ── normalizePath ──────────────────────────────────────────────────────────

describe('normalizePath', () => {
  test('returns "/" for root', () => {
    expect(normalizePath('/')).toBe('/');
  });

  test('resolves double-dot segments', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
  });

  test('resolves multiple consecutive double-dots', () => {
    expect(normalizePath('/a/b/c/../../d')).toBe('/a/d');
  });

  test('resolves single-dot segments', () => {
    expect(normalizePath('/a/./b')).toBe('/a/b');
  });

  test('does not go above root', () => {
    expect(normalizePath('/a/../../..')).toBe('/');
  });

  test('strips trailing slashes', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });

  test('handles a plain absolute path', () => {
    expect(normalizePath('/home/alice/Documents')).toBe('/home/alice/Documents');
  });
});

// ── resolvePath ────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  test('returns base unchanged when input is empty', () => {
    expect(resolvePath('/home/alice', '')).toBe('/home/alice');
  });

  test('returns base unchanged when input is "."', () => {
    expect(resolvePath('/home/alice', '.')).toBe('/home/alice');
  });

  test('resolves a relative name against base', () => {
    expect(resolvePath('/home/alice', 'notes')).toBe('/home/alice/notes');
  });

  test('resolves ".." to parent', () => {
    expect(resolvePath('/home/alice', '..')).toBe('/home');
  });

  test('resolves ".." at root stays at root', () => {
    expect(resolvePath('/', '..')).toBe('/');
  });

  test('treats an absolute input as-is', () => {
    expect(resolvePath('/home/alice', '/tmp')).toBe('/tmp');
  });

  test('resolves deeply relative paths', () => {
    expect(resolvePath('/home/alice', 'docs/../notes/todo.md')).toBe(
      '/home/alice/notes/todo.md'
    );
  });

  test('joins correctly when base is root "/"', () => {
    expect(resolvePath('/', 'home')).toBe('/home');
  });
});

// ── getDirectChildren ─────────────────────────────────────────────────────

describe('getDirectChildren', () => {
  const records = [
    { path: '/home', name: 'home', is_directory: true },
    { path: '/home/alice', name: 'alice', is_directory: true },
    { path: '/home/alice/notes.txt', name: 'notes.txt', is_directory: false },
    { path: '/home/alice/docs', name: 'docs', is_directory: true },
    { path: '/home/alice/docs/report.md', name: 'report.md', is_directory: false },
    { path: '/tmp', name: 'tmp', is_directory: true },
  ];

  test('returns direct children of a directory', () => {
    const children = getDirectChildren(records, '/home/alice');
    const paths = children.map((r) => r.path);
    expect(paths).toContain('/home/alice/notes.txt');
    expect(paths).toContain('/home/alice/docs');
    expect(paths).not.toContain('/home/alice/docs/report.md'); // grandchild
    expect(paths).not.toContain('/home');                       // parent
    expect(paths).not.toContain('/tmp');                        // unrelated
  });

  test('returns direct children of root "/"', () => {
    const children = getDirectChildren(records, '/');
    const paths = children.map((r) => r.path);
    expect(paths).toContain('/home');
    expect(paths).toContain('/tmp');
    expect(paths).not.toContain('/home/alice'); // grandchild of root
  });

  test('returns empty array when directory is empty', () => {
    expect(getDirectChildren(records, '/tmp')).toHaveLength(0);
  });

  test('returns empty array for an unknown path', () => {
    expect(getDirectChildren(records, '/nonexistent')).toHaveLength(0);
  });

  test('returns empty array for empty records list', () => {
    expect(getDirectChildren([], '/home/alice')).toHaveLength(0);
  });

  test('does not include the directory itself', () => {
    const r = [{ path: '/home/alice', name: 'alice', is_directory: true }];
    expect(getDirectChildren(r, '/home/alice')).toHaveLength(0);
  });
});
