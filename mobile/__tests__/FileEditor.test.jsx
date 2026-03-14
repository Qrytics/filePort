/**
 * Tests for FileEditor React Native component.
 *
 * FileEditor is a full-screen dark-mode text editor used by TerminalCLI when
 * the user types `edit <file>`.  All network calls are handled by the parent;
 * FileEditor only receives callbacks, so these tests require no Supabase mocks.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { FileEditor } from '../src/components/FileEditor';

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  filePath: '/home/alice/notes.txt',
  fileName: 'notes.txt',
  initialContent: 'Hello, world!',
  onSave: jest.fn(),
  onCancel: jest.fn(),
};

function renderEditor(overrides = {}) {
  const props = { ...DEFAULT_PROPS, ...overrides };
  return { ...render(<FileEditor {...props} />), props };
}

// ── Rendering ──────────────────────────────────────────────────────────────

describe('FileEditor — rendering', () => {
  test('shows the full file path in the header', () => {
    renderEditor();
    expect(screen.getByTestId('editor-filepath').props.children).toBe(
      '/home/alice/notes.txt'
    );
  });

  test('shows the filename in the header', () => {
    renderEditor();
    expect(screen.getByTestId('editor-filename').props.children).toBe('notes.txt');
  });

  test('pre-fills the text input with the initial content', () => {
    renderEditor();
    expect(screen.getByTestId('editor-input').props.value).toBe('Hello, world!');
  });

  test('renders with empty content when initialContent is null', () => {
    renderEditor({ initialContent: null });
    expect(screen.getByTestId('editor-input').props.value).toBe('');
  });

  test('renders Cancel and Save buttons', () => {
    renderEditor();
    expect(screen.getByTestId('editor-cancel')).toBeTruthy();
    expect(screen.getByTestId('editor-save')).toBeTruthy();
  });

  test('does not show error banner initially', () => {
    renderEditor();
    expect(screen.queryByTestId('editor-error')).toBeNull();
  });
});

// ── Cancel ─────────────────────────────────────────────────────────────────

describe('FileEditor — Cancel button', () => {
  test('calls onCancel when Cancel is pressed', () => {
    const onCancel = jest.fn();
    renderEditor({ onCancel });
    fireEvent.press(screen.getByTestId('editor-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── Save (success) ─────────────────────────────────────────────────────────

describe('FileEditor — Save button (success)', () => {
  test('calls onSave with the current content', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    expect(onSave).toHaveBeenCalledWith('Hello, world!');
  });

  test('calls onSave with edited content after the user types', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });

    fireEvent.changeText(screen.getByTestId('editor-input'), 'Updated content');

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    expect(onSave).toHaveBeenCalledWith('Updated content');
  });

  test('shows ActivityIndicator while saving', async () => {
    // onSave never resolves during this test — we check the loading state.
    let resolve;
    const onSave = jest.fn().mockImplementation(
      () => new Promise((res) => { resolve = res; })
    );
    renderEditor({ onSave });

    act(() => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-saving')).toBeTruthy();
    });

    // Clean up the dangling promise.
    await act(async () => { resolve(); });
  });

  test('disables Cancel and Save while saving', async () => {
    let resolve;
    const onSave = jest.fn().mockImplementation(
      () => new Promise((res) => { resolve = res; })
    );
    renderEditor({ onSave });

    act(() => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-cancel').props.accessibilityState?.disabled).toBeTruthy();
      expect(screen.getByTestId('editor-save').props.accessibilityState?.disabled).toBeTruthy();
    });

    await act(async () => { resolve(); });
  });
});

// ── Save (error) ───────────────────────────────────────────────────────────

describe('FileEditor — Save button (error)', () => {
  test('displays an error banner when onSave throws', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Network timeout'));
    renderEditor({ onSave });

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-error')).toBeTruthy();
      expect(screen.getByText(/Network timeout/)).toBeTruthy();
    });
  });

  test('keeps the editor open after a save error', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Conflict'));
    renderEditor({ onSave });

    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });

    await waitFor(() => {
      // Editor is still visible (not dismissed).
      expect(screen.getByTestId('file-editor')).toBeTruthy();
      // Save button is still available for retry.
      expect(screen.getByTestId('editor-save')).toBeTruthy();
    });
  });

  test('clears the error banner on a subsequent successful save', async () => {
    const onSave = jest
      .fn()
      .mockRejectedValueOnce(new Error('Conflict'))
      .mockResolvedValue(undefined);
    renderEditor({ onSave });

    // First save — triggers error.
    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('editor-error')).toBeTruthy();
    });

    // Second save — succeeds; FileEditor calls onSave again (no error displayed).
    await act(async () => {
      fireEvent.press(screen.getByTestId('editor-save'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('editor-error')).toBeNull();
    });
  });
});
