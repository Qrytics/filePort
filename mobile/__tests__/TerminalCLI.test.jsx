/**
 * Tests for TerminalCLI React Native component.
 *
 * Supabase is mocked via the mock factory below. React Native modules are
 * provided by the react-native jest preset.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { TerminalCLI } from '../src/components/TerminalCLI';

// ── Supabase mock ──────────────────────────────────────────────────────────

function makeSupabaseMock({
  lsData = [],
  checkIsDir = true,
  lsError = null,
  checkError = null,
  fileData = null,
  fileError = null,
  saveError = null,
} = {}) {
  // The query builder for `.like(...)` calls (used by listDirectory).
  const listBuilder = {
    select: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve) => resolve({ data: lsData, error: lsError }),
  };

  // The query builder for `.eq(...).single()` calls (used by checkDirectory).
  const checkBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: checkError ? null : { is_directory: checkIsDir },
      error: checkError,
    }),
  };

  return {
    from: jest.fn().mockImplementation((table) => {
      if (table !== 'remote_files') throw new Error(`Unexpected table: ${table}`);
      return {
        select: jest.fn().mockImplementation((cols) => ({
          like: jest.fn().mockImplementation(() => ({
            order: jest.fn().mockImplementation(() => ({
              order: jest.fn().mockResolvedValue({ data: lsData, error: lsError }),
            })),
          })),
          eq: jest.fn().mockImplementation(() => ({
            single: jest.fn().mockImplementation(() => {
              // fetchFile selects 'content'; checkDirectory selects 'is_directory'
              if (typeof cols === 'string' && cols.includes('content')) {
                return Promise.resolve({ data: fileData, error: fileError });
              }
              return Promise.resolve({
                data: checkError ? null : { is_directory: checkIsDir },
                error: checkError,
              });
            }),
          })),
        })),
        update: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: null, error: saveError }),
        })),
      };
    }),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Type text into the terminal input and submit it.
 * We re-query the element after changeText to ensure we call the freshest
 * onSubmitEditing handler after any React re-renders.
 */
async function submitCommand(commandText) {
  fireEvent.changeText(screen.getByTestId('terminal-input'), commandText);
  await act(async () => {
    screen.getByTestId('terminal-input').props.onSubmitEditing();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TerminalCLI — rendering', () => {
  test('renders the banner lines on mount', () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} />);

    expect(screen.getByText(/filePort Mobile Terminal/)).toBeTruthy();
    expect(screen.getByText(/Type "help"/)).toBeTruthy();
  });

  test('renders the prompt with the initial cwd', () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} initialPath="/home/alice" />);

    expect(screen.getByTestId('terminal-prompt').props.children).toContain('/home/alice');
  });

  test('renders the text input', () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} />);
    expect(screen.getByTestId('terminal-input')).toBeTruthy();
  });
});

describe('TerminalCLI — help command', () => {
  test('displays help text when "help" is submitted', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} />);

    await submitCommand('help');

    await waitFor(() => {
      expect(screen.getByText(/ls \[path\]/)).toBeTruthy();
      expect(screen.getByText(/cd <path>/)).toBeTruthy();
    });
  });
});

describe('TerminalCLI — pwd command', () => {
  test('prints the current working directory', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} initialPath="/home/alice" />);

    await submitCommand('pwd');

    await waitFor(() => {
      expect(screen.getByText('/home/alice')).toBeTruthy();
    });
  });
});

describe('TerminalCLI — unknown command', () => {
  test('shows "command not found" for unrecognised input', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} />);

    await submitCommand('foobar');

    await waitFor(() => {
      expect(screen.getByText(/foobar: command not found/)).toBeTruthy();
    });
  });
});

describe('TerminalCLI — ls command', () => {
  test('lists directory entries returned by Supabase', async () => {
    const lsData = [
      { path: '/docs', name: 'docs', is_directory: true, file_size: 0 },
      { path: '/readme.txt', name: 'readme.txt', is_directory: false, file_size: 512 },
    ];
    const supabase = makeSupabaseMock({ lsData });

    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('ls');

    await waitFor(() => {
      expect(screen.getByText(/📁\s+docs\//)).toBeTruthy();
      expect(screen.getByText(/📄\s+readme\.txt/)).toBeTruthy();
    });
  });

  test('shows "(empty directory)" when there are no results', async () => {
    const supabase = makeSupabaseMock({ lsData: [] });
    render(<TerminalCLI supabase={supabase} />);

    await submitCommand('ls');

    await waitFor(() => {
      expect(screen.getByText('(empty directory)')).toBeTruthy();
    });
  });

  test('shows error message when Supabase returns an error', async () => {
    const supabase = makeSupabaseMock({
      lsError: { message: 'Connection refused' },
    });
    render(<TerminalCLI supabase={supabase} />);

    await submitCommand('ls');

    await waitFor(() => {
      expect(screen.getByText(/Connection refused/)).toBeTruthy();
    });
  });
});

describe('TerminalCLI — cd command', () => {
  test('cd with no args navigates to root', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} initialPath="/home/alice" />);

    await submitCommand('cd');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt').props.children).toContain('/');
    });
  });

  test('cd into a valid directory updates the prompt', async () => {
    const supabase = makeSupabaseMock({ checkIsDir: true });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('cd home');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt').props.children).toContain('/home');
    });
  });

  test('cd into a non-directory path shows an error', async () => {
    const supabase = makeSupabaseMock({ checkIsDir: false });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('cd readme.txt');

    await waitFor(() => {
      expect(screen.getByText(/cd: readme\.txt: No such directory/)).toBeTruthy();
    });
  });

  test('cd / navigates directly to root', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} initialPath="/home/alice" />);

    await submitCommand('cd /');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt').props.children).toContain('/');
    });
  });

  test('cd .. navigates to the parent directory', async () => {
    const supabase = makeSupabaseMock({ checkIsDir: true });
    render(<TerminalCLI supabase={supabase} initialPath="/home/alice" />);

    await submitCommand('cd ..');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt').props.children).toContain('/home');
    });
  });
});

describe('TerminalCLI — edit command', () => {
  const FILE_RECORD = {
    path: '/readme.txt',
    name: 'readme.txt',
    content: 'Hello, world!',
    is_directory: false,
  };

  test('edit with no args shows usage error', async () => {
    const supabase = makeSupabaseMock();
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit');

    await waitFor(() => {
      expect(screen.getByText(/edit: usage: edit <filename>/)).toBeTruthy();
    });
  });

  test('edit a file opens the FileEditor full-screen', async () => {
    const supabase = makeSupabaseMock({ fileData: FILE_RECORD });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit readme.txt');

    await waitFor(() => {
      expect(screen.getByTestId('file-editor')).toBeTruthy();
      expect(screen.getByTestId('editor-filename').props.children).toBe('readme.txt');
      expect(screen.getByTestId('editor-input').props.value).toBe('Hello, world!');
    });
  });

  test('edit a directory shows an error', async () => {
    const dirRecord = { ...FILE_RECORD, is_directory: true };
    const supabase = makeSupabaseMock({ fileData: dirRecord });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit docs');

    await waitFor(() => {
      expect(screen.getByText(/Is a directory/)).toBeTruthy();
      expect(screen.queryByTestId('file-editor')).toBeNull();
    });
  });

  test('edit a non-existent file shows error', async () => {
    const supabase = makeSupabaseMock({
      fileError: { message: '/nope.txt: No such file or directory', code: 'PGRST116' },
    });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit nope.txt');

    await waitFor(() => {
      expect(screen.getByText(/No such file or directory/)).toBeTruthy();
      expect(screen.queryByTestId('file-editor')).toBeNull();
    });
  });

  test('Cancel in editor returns to terminal', async () => {
    const supabase = makeSupabaseMock({ fileData: FILE_RECORD });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit readme.txt');

    await waitFor(() => {
      expect(screen.getByTestId('file-editor')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-cancel'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('file-editor')).toBeNull();
      expect(screen.getByTestId('terminal-input')).toBeTruthy();
    });
  });

  test('Save in editor calls saveFile and returns to terminal on success', async () => {
    const supabase = makeSupabaseMock({ fileData: FILE_RECORD, saveError: null });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit readme.txt');

    await waitFor(() => {
      expect(screen.getByTestId('file-editor')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('editor-input'), 'New content');
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      // Editor is dismissed after a successful save.
      expect(screen.queryByTestId('file-editor')).toBeNull();
      // Terminal shows a confirmation line.
      expect(screen.getByText(/Saved: \/readme\.txt/)).toBeTruthy();
    });
  });

  test('Save error keeps editor open', async () => {
    const supabase = makeSupabaseMock({
      fileData: FILE_RECORD,
      saveError: { message: 'Conflict' },
    });
    render(<TerminalCLI supabase={supabase} initialPath="/" />);

    await submitCommand('edit readme.txt');

    await waitFor(() => {
      expect(screen.getByTestId('file-editor')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-editor')).toBeTruthy();
      expect(screen.getByText(/Conflict/)).toBeTruthy();
    });
  });
});
