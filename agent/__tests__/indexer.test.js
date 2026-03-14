const { buildFileRecord, walkDir } = require('../src/indexer');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('indexer — buildFileRecord', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileport-idx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const textExtensions = ['.txt', '.md', '.js', '.py'];
  const maxSize = 1_048_576;

  test('returns correct record for a text file', () => {
    const filePath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(filePath, 'Hello world');
    const stat = fs.statSync(filePath);

    const record = buildFileRecord(filePath, stat, false, textExtensions, maxSize);

    expect(record.path).toBe(filePath);
    expect(record.name).toBe('note.txt');
    expect(record.content).toBe('Hello world');
    expect(record.is_directory).toBe(false);
    expect(record.needs_sync).toBe(false);
    expect(record.file_size).toBe(stat.size);
    expect(record.mime_type).toMatch(/text/);
    expect(record.last_modified_local).toBe(stat.mtime.toISOString());
  });

  test('returns empty content for non-text file', () => {
    const filePath = path.join(tmpDir, 'image.png');
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const stat = fs.statSync(filePath);

    const record = buildFileRecord(filePath, stat, false, textExtensions, maxSize);

    expect(record.content).toBe('');
    expect(record.mime_type).toBe('image/png');
  });

  test('returns empty content when file exceeds maxFileSizeBytes', () => {
    const filePath = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(filePath, 'x'.repeat(100));
    const stat = fs.statSync(filePath);

    const record = buildFileRecord(filePath, stat, false, textExtensions, 10);

    expect(record.content).toBe('');
  });

  test('returns correct record for a directory', () => {
    const record = buildFileRecord(tmpDir, null, true, textExtensions, maxSize);

    expect(record.is_directory).toBe(true);
    expect(record.content).toBe('');
    expect(record.file_size).toBe(0);
    expect(record.mime_type).toBe('inode/directory');
  });

  test('sets last_modified_local from stat.mtime for files', () => {
    const filePath = path.join(tmpDir, 'ts.md');
    fs.writeFileSync(filePath, '# Test');
    const stat = fs.statSync(filePath);

    const record = buildFileRecord(filePath, stat, false, textExtensions, maxSize);

    expect(record.last_modified_local).toBe(stat.mtime.toISOString());
  });

  test('sets needs_sync to false on initial index', () => {
    const filePath = path.join(tmpDir, 'fresh.py');
    fs.writeFileSync(filePath, 'print("hi")');
    const stat = fs.statSync(filePath);

    const record = buildFileRecord(filePath, stat, false, textExtensions, maxSize);

    expect(record.needs_sync).toBe(false);
  });
});

describe('indexer — walkDir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileport-walk-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('discovers all files and directories recursively', () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'root');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'child.txt'), 'child');

    const found = [];
    walkDir(tmpDir, (fp, stat, isDir) => found.push({ fp, isDir }), ['.txt'], 1_048_576);

    const paths = found.map((f) => f.fp);
    expect(paths).toContain(path.join(tmpDir, 'sub'));
    expect(paths).toContain(path.join(tmpDir, 'root.txt'));
    expect(paths).toContain(path.join(tmpDir, 'sub', 'child.txt'));
  });

  test('skips hidden files and directories', () => {
    fs.writeFileSync(path.join(tmpDir, '.hidden'), 'secret');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, 'visible.txt'), 'visible');

    const found = [];
    walkDir(tmpDir, (fp) => found.push(fp), ['.txt'], 1_048_576);

    expect(found).toContain(path.join(tmpDir, 'visible.txt'));
    expect(found).not.toContain(path.join(tmpDir, '.hidden'));
    expect(found).not.toContain(path.join(tmpDir, '.git'));
  });

  test('handles unreadable directories gracefully without throwing', () => {
    const badDir = path.join(tmpDir, 'noperm');
    fs.mkdirSync(badDir, { mode: 0o000 });

    expect(() =>
      walkDir(tmpDir, () => {}, ['.txt'], 1_048_576)
    ).not.toThrow();

    fs.chmodSync(badDir, 0o755); // restore so cleanup works
  });

  test('returns nothing for an empty directory', () => {
    const found = [];
    walkDir(tmpDir, (fp) => found.push(fp), ['.txt'], 1_048_576);
    expect(found).toHaveLength(0);
  });
});
