const { isMobileNewer, applyRecord, reconcile } = require('../src/reconciler');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('reconciler — isMobileNewer', () => {
  test('returns false when last_modified_mobile is null', () => {
    expect(isMobileNewer(null, '2024-01-01T00:00:00.000Z')).toBe(false);
  });

  test('returns true when last_modified_local is null', () => {
    expect(isMobileNewer('2024-01-02T00:00:00.000Z', null)).toBe(true);
  });

  test('returns true when mobile timestamp is newer', () => {
    expect(
      isMobileNewer('2024-01-03T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
    ).toBe(true);
  });

  test('returns false when local timestamp is newer', () => {
    expect(
      isMobileNewer('2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z')
    ).toBe(false);
  });

  test('returns false when timestamps are equal', () => {
    const ts = '2024-06-15T12:00:00.000Z';
    expect(isMobileNewer(ts, ts)).toBe(false);
  });
});

describe('reconciler — applyRecord', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileport-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePbClient(overrides = {}) {
    return {
      markSynced: jest.fn().mockResolvedValue({}),
      ...overrides,
    };
  }

  test('applies mobile content to a new local file', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    const record = {
      id: 'rec1',
      path: filePath,
      name: 'hello.txt',
      content: 'Hello from mobile!',
      is_directory: false,
      last_modified_mobile: '2024-06-15T12:00:00.000Z',
      last_modified_local: '2024-06-14T10:00:00.000Z',
      needs_sync: true,
    };
    const pb = makePbClient();

    const result = await applyRecord(record, pb);

    expect(result.status).toBe('applied');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('Hello from mobile!');
    expect(pb.markSynced).toHaveBeenCalledWith('rec1', expect.any(String));
  });

  test('skips when local is not older than mobile', async () => {
    const filePath = path.join(tmpDir, 'unchanged.txt');
    fs.writeFileSync(filePath, 'local content');

    const record = {
      id: 'rec2',
      path: filePath,
      name: 'unchanged.txt',
      content: 'different mobile content',
      is_directory: false,
      last_modified_mobile: '2024-06-10T00:00:00.000Z',
      last_modified_local:  '2024-06-15T00:00:00.000Z',
      needs_sync: true,
    };
    const pb = makePbClient();

    const result = await applyRecord(record, pb);

    expect(result.status).toBe('skipped');
    // Local file must remain untouched
    expect(fs.readFileSync(filePath, 'utf8')).toBe('local content');
  });

  test('creates parent directories if they do not exist', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'note.md');
    const record = {
      id: 'rec3',
      path: filePath,
      name: 'note.md',
      content: '# Hello',
      is_directory: false,
      last_modified_mobile: '2024-06-20T00:00:00.000Z',
      last_modified_local:  '2024-01-01T00:00:00.000Z',
      needs_sync: true,
    };
    const pb = makePbClient();

    const result = await applyRecord(record, pb);

    expect(result.status).toBe('applied');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('# Hello');
  });

  test('creates missing directory entry', async () => {
    const dirPath = path.join(tmpDir, 'new-folder');
    const record = {
      id: 'rec4',
      path: dirPath,
      name: 'new-folder',
      content: '',
      is_directory: true,
      last_modified_mobile: '2024-06-20T00:00:00.000Z',
      last_modified_local:  null,
      needs_sync: true,
    };
    const pb = makePbClient();

    const result = await applyRecord(record, pb);

    expect(result.status).toBe('applied');
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  test('returns error when markSynced fails after writing', async () => {
    const filePath = path.join(tmpDir, 'fail.txt');
    const record = {
      id: 'rec5',
      path: filePath,
      name: 'fail.txt',
      content: 'content',
      is_directory: false,
      last_modified_mobile: '2024-06-20T00:00:00.000Z',
      last_modified_local:  '2024-01-01T00:00:00.000Z',
      needs_sync: true,
    };
    const pb = makePbClient({
      markSynced: jest.fn().mockRejectedValue(new Error('DB unreachable')),
    });

    const result = await applyRecord(record, pb);

    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/DB unreachable/);
    // File should still have been written
    expect(fs.readFileSync(filePath, 'utf8')).toBe('content');
  });
});

describe('reconciler — reconcile', () => {
  test('returns empty array when no pending files', async () => {
    const pb = {
      getPendingSyncFiles: jest.fn().mockResolvedValue([]),
    };
    const results = await reconcile(pb);
    expect(results).toEqual([]);
  });

  test('returns empty array on getPendingSyncFiles failure', async () => {
    const pb = {
      getPendingSyncFiles: jest.fn().mockRejectedValue(new Error('Network error')),
    };
    const results = await reconcile(pb);
    expect(results).toEqual([]);
  });

  test('applies all pending records', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileport-rec-'));
    try {
      const file1 = path.join(tmpDir, 'a.txt');
      const file2 = path.join(tmpDir, 'b.txt');

      const pb = {
        getPendingSyncFiles: jest.fn().mockResolvedValue([
          {
            id: 'r1', path: file1, name: 'a.txt', content: 'AAA',
            is_directory: false,
            last_modified_mobile: '2024-06-20T00:00:00.000Z',
            last_modified_local:  '2024-01-01T00:00:00.000Z',
            needs_sync: true,
          },
          {
            id: 'r2', path: file2, name: 'b.txt', content: 'BBB',
            is_directory: false,
            last_modified_mobile: '2024-06-20T00:00:00.000Z',
            last_modified_local:  '2024-01-01T00:00:00.000Z',
            needs_sync: true,
          },
        ]),
        markSynced: jest.fn().mockResolvedValue({}),
      };

      const results = await reconcile(pb);

      expect(results.length).toBe(2);
      expect(results.every((r) => r.status === 'applied')).toBe(true);
      expect(fs.readFileSync(file1, 'utf8')).toBe('AAA');
      expect(fs.readFileSync(file2, 'utf8')).toBe('BBB');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
