/**
 * Pure path utility functions for the virtual file-system navigation.
 *
 * These functions operate entirely on strings — no I/O, no side effects —
 * making them straightforward to unit-test without any mocking.
 */

/**
 * Normalise an absolute path by resolving `.` and `..` segments.
 * Always returns a path that starts with `/`.
 *
 * Examples:
 *   normalizePath('/a/b/../c')  → '/a/c'
 *   normalizePath('/a/./b')     → '/a/b'
 *   normalizePath('/')          → '/'
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  const parts = p.split('/').filter(Boolean);
  const stack = [];
  for (const part of parts) {
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else if (part !== '.') {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

/**
 * Resolve `input` relative to `base`.
 *
 * - If `input` starts with `/` it is treated as absolute.
 * - Otherwise it is joined onto `base`.
 * - `..` and `.` are resolved via `normalizePath`.
 * - An empty or missing `input` returns `base` unchanged.
 *
 * Examples:
 *   resolvePath('/home/alice', 'notes')    → '/home/alice/notes'
 *   resolvePath('/home/alice', '..')       → '/home'
 *   resolvePath('/home/alice', '/tmp')     → '/tmp'
 *
 * @param {string} base   – the current working directory
 * @param {string} [input]
 * @returns {string}
 */
function resolvePath(base, input) {
  if (!input || input === '.') return base;
  if (input.startsWith('/')) return normalizePath(input);
  const joined = base === '/' ? `/${input}` : `${base}/${input}`;
  return normalizePath(joined);
}

/**
 * Given a flat list of file/directory records (each with a `path` field),
 * return only the *direct* children of `dirPath`.
 *
 * A record is a direct child of `dirPath` when its path:
 *   1. Starts with `${dirPath}/` (or just `/` when dirPath is `'/'`)
 *   2. Has no further `/` separators after the prefix
 *
 * Examples (dirPath = '/home'):
 *   '/home/alice'         → included  (direct child)
 *   '/home/alice/notes'   → excluded  (grandchild)
 *   '/tmp/foo'            → excluded  (different branch)
 *
 * @param {Array<{path: string}>} records
 * @param {string}                dirPath
 * @returns {Array<{path: string}>}
 */
function getDirectChildren(records, dirPath) {
  // The prefix we expect each direct child's path to start with.
  const prefix = dirPath === '/' ? '/' : `${dirPath}/`;

  return records.filter((record) => {
    if (!record.path.startsWith(prefix)) return false;
    const remainder = record.path.slice(prefix.length);
    // Must be non-empty and contain no further path separators.
    return remainder.length > 0 && !remainder.includes('/');
  });
}

module.exports = { normalizePath, resolvePath, getDirectChildren };
