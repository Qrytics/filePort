/**
 * TerminalCLI — React Native component that provides a command-line interface
 * for navigating the virtual file system stored in the Supabase `remote_files`
 * table.
 *
 * Supported commands:
 *   ls [path]          – list files/directories at [path] (defaults to cwd)
 *   cd <path>          – change the current virtual directory
 *   pwd                – print the current directory
 *   edit <file>        – open a file in the full-screen editor
 *   help               – show available commands
 *
 * Props:
 *   supabase  {SupabaseClient}  – configured Supabase client (required)
 *   initialPath {string}        – starting directory (default: '/')
 *   style {object}              – additional styles for the outer container
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { useRemoteFiles } from '../hooks/useRemoteFiles';
import { FileEditor } from './FileEditor';
import { resolvePath } from '../utils/pathUtils';

// ── Line types and their corresponding styles ──────────────────────────────

const LINE_STYLES = {
  banner:  { color: '#7ec8e3', fontWeight: 'bold' },
  info:    { color: '#aaaaaa' },
  command: { color: '#e0e0e0' },
  output:  { color: '#e0e0e0' },
  error:   { color: '#f44336' },
};

// ── Component ─────────────────────────────────────────────────────────────

export function TerminalCLI({ supabase, initialPath = '/', style }) {
  const [cwd, setCwd] = useState(initialPath);
  const [history, setHistory] = useState([
    { id: 0, text: '╔══════════════════════════════╗', type: 'banner' },
    { id: 1, text: '║   filePort Mobile Terminal   ║', type: 'banner' },
    { id: 2, text: '╚══════════════════════════════╝', type: 'banner' },
    { id: 3, text: 'Type "help" for available commands.', type: 'info' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // When non-null, the FileEditor is rendered instead of the terminal.
  const [editingFile, setEditingFile] = useState(null);

  const scrollRef = useRef(null);
  const nextId = useRef(4);
  // Keep a ref to the current input text so handleSubmit is never stale.
  const inputRef = useRef('');

  const { listDirectory, checkDirectory, fetchFile, saveFile } = useRemoteFiles(supabase);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const addLine = useCallback((text, type = 'output') => {
    setHistory((prev) => [...prev, { id: nextId.current++, text, type }]);
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [history, scrollToBottom]);

  // ── Command handlers ─────────────────────────────────────────────────────

  const cmdLs = useCallback(
    async (args, currentCwd) => {
      const targetPath = args[0] ? resolvePath(currentCwd, args[0]) : currentCwd;
      addLine(`Listing: ${targetPath}`, 'info');

      const entries = await listDirectory(targetPath);

      if (entries.length === 0) {
        addLine('(empty directory)', 'output');
        return;
      }

      for (const entry of entries) {
        const icon   = entry.is_directory ? '📁' : '📄';
        const suffix = entry.is_directory ? '/' : '';
        addLine(`${icon}  ${entry.name}${suffix}`, 'output');
      }
    },
    [addLine, listDirectory]
  );

  const cmdCd = useCallback(
    async (args, currentCwd, updateCwd) => {
      // `cd` with no arguments goes to root
      if (!args[0]) {
        updateCwd('/');
        addLine('Changed directory to /', 'info');
        return;
      }

      const targetPath = resolvePath(currentCwd, args[0]);

      if (targetPath === '/') {
        updateCwd('/');
        addLine('Changed directory to /', 'info');
        return;
      }

      const isDir = await checkDirectory(targetPath);
      if (!isDir) {
        addLine(`cd: ${args[0]}: No such directory`, 'error');
        return;
      }

      updateCwd(targetPath);
      addLine(`Changed directory to ${targetPath}`, 'info');
    },
    [addLine, checkDirectory]
  );

  const cmdEdit = useCallback(
    async (args, currentCwd) => {
      if (!args[0]) {
        addLine('edit: usage: edit <filename>', 'error');
        return;
      }

      const targetPath = resolvePath(currentCwd, args[0]);
      addLine(`Opening: ${targetPath}`, 'info');

      const file = await fetchFile(targetPath);

      if (file.is_directory) {
        addLine(`edit: ${args[0]}: Is a directory`, 'error');
        return;
      }

      setEditingFile({
        path: file.path,
        name: file.name,
        content: file.content ?? '',
      });
    },
    [addLine, fetchFile]
  );

  const handleEditorSave = useCallback(
    async (newContent) => {
      // Will throw on Supabase error — FileEditor displays the error inline.
      await saveFile(editingFile.path, newContent);
      addLine(`Saved: ${editingFile.path}`, 'info');
      setEditingFile(null);
    },
    [editingFile, saveFile, addLine]
  );

  const handleEditorCancel = useCallback(() => {
    addLine(`Cancelled edit: ${editingFile?.path}`, 'info');
    setEditingFile(null);
  }, [editingFile, addLine]);

  // ── Command dispatcher ───────────────────────────────────────────────────

  const runCommand = useCallback(
    async (rawLine, currentCwd, updateCwd) => {
      const line = rawLine.trim();
      if (!line) return;

      // Echo the typed command
      addLine(`${currentCwd}$ ${line}`, 'command');

      const [cmd, ...args] = line.split(/\s+/);

      setLoading(true);
      try {
        switch (cmd.toLowerCase()) {
          case 'ls':
            await cmdLs(args, currentCwd);
            break;

          case 'cd':
            await cmdCd(args, currentCwd, updateCwd);
            break;

          case 'edit':
            await cmdEdit(args, currentCwd);
            break;

          case 'pwd':
            addLine(currentCwd, 'output');
            break;

          case 'help':
            addLine('Commands:', 'info');
            addLine('  ls [path]      – list files and directories', 'output');
            addLine('  cd <path>      – change directory (supports ..)', 'output');
            addLine('  edit <file>    – open a file in the editor', 'output');
            addLine('  pwd            – print current directory', 'output');
            addLine('  help           – show this message', 'output');
            break;

          default:
            addLine(`${cmd}: command not found. Type "help" for help.`, 'error');
        }
      } catch (err) {
        addLine(`Error: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    },
    [addLine, cmdLs, cmdCd, cmdEdit]
  );

  // ── Submit handler ───────────────────────────────────────────────────────

  const handleChangeText = useCallback((text) => {
    setInput(text);
    inputRef.current = text;
  }, []);

  const handleSubmit = useCallback(() => {
    // Read from the ref so this callback is never stale regardless of
    // when React last re-rendered with the latest `input` state.
    const cmd = inputRef.current;
    inputRef.current = '';
    setInput('');
    // Capture cwd at submit time to avoid stale-closure issues; pass the
    // state setter so async handlers can update it atomically.
    runCommand(cmd, cwd, setCwd);
  }, [cwd, runCommand]);

  // ── Render ───────────────────────────────────────────────────────────────

  // When a file is being edited, replace the terminal with the full-screen editor.
  if (editingFile) {
    return (
      <FileEditor
        filePath={editingFile.path}
        fileName={editingFile.name}
        initialContent={editingFile.content}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.output}
        contentContainerStyle={styles.outputContent}
        keyboardShouldPersistTaps="handled"
        testID="terminal-output"
      >
        {history.map((line) => (
          <Text
            key={line.id}
            style={[styles.line, LINE_STYLES[line.type] || LINE_STYLES.output]}
            testID={`terminal-line-${line.type}`}
          >
            {line.text}
          </Text>
        ))}
        {loading && (
          <Text style={[styles.line, LINE_STYLES.info]} testID="terminal-loading">
            …
          </Text>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <Text style={styles.prompt} testID="terminal-prompt">
          {cwd}${' '}
        </Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          blurOnSubmit={false}
          placeholder="enter command…"
          placeholderTextColor="#555"
          editable={!loading}
          testID="terminal-input"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  output: {
    flex: 1,
    padding: 8,
  },
  outputContent: {
    paddingBottom: 8,
  },
  line: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 14,
    lineHeight: 22,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#111',
  },
  prompt: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 14,
    color: '#4caf50',
  },
  input: {
    flex: 1,
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 14,
    color: '#e0e0e0',
    paddingVertical: 4,
  },
});
