/**
 * FileEditor — full-screen dark-mode text editor for a single remote file.
 *
 * The component is rendered by TerminalCLI when the user types `edit <file>`.
 * On pressing Save the caller's `onSave(content)` async function is invoked;
 * if it resolves the editor is dismissed by the parent.  On error, a message
 * is shown inline so the user can retry without losing their changes.
 *
 * Props:
 *   filePath        {string}                   – absolute path shown in the header
 *   fileName        {string}                   – just the filename portion
 *   initialContent  {string}                   – content fetched from the DB
 *   onSave          {(content: string) => Promise<void>}  – async save handler
 *   onCancel        {() => void}               – called when Cancel is pressed
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';

// ── Component ─────────────────────────────────────────────────────────────

export function FileEditor({ filePath, fileName, initialContent, onSave, onCancel }) {
  const [content, setContent] = useState(initialContent ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(content);
      // Parent dismisses the editor on success; no state update needed here.
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [content, onSave]);

  return (
    <SafeAreaView style={styles.container} testID="file-editor">
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerPath} numberOfLines={1} testID="editor-filepath">
          {filePath}
        </Text>
        <Text style={styles.headerName} testID="editor-filename">
          {fileName}
        </Text>
      </View>

      {/* ── Edit area ── */}
      <ScrollView
        style={styles.editorScroll}
        contentContainerStyle={styles.editorScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={styles.editorInput}
          value={content}
          onChangeText={setContent}
          multiline
          scrollEnabled={false}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={!saving}
          testID="editor-input"
        />
      </ScrollView>

      {/* ── Error banner ── */}
      {saveError ? (
        <View style={styles.errorBanner} testID="editor-error">
          <Text style={styles.errorText}>⚠  {saveError}</Text>
        </View>
      ) : null}

      {/* ── Action bar ── */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={onCancel}
          disabled={saving}
          testID="editor-cancel"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          testID="editor-save"
        >
          {saving ? (
            <ActivityIndicator size="small" color="#0d0d0d" testID="editor-saving" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const MONO = Platform.select({ ios: 'Courier New', android: 'monospace' });

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerPath: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#555',
    marginBottom: 2,
  },
  headerName: {
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 'bold',
    color: '#4caf50',
  },

  // ── Edit area ───────────────────────────────────────────────────────────
  editorScroll: {
    flex: 1,
  },
  editorScrollContent: {
    flexGrow: 1,
  },
  editorInput: {
    flex: 1,
    minHeight: '100%',
    fontFamily: MONO,
    fontSize: 14,
    lineHeight: 22,
    color: '#e0e0e0',
    padding: 12,
    textAlignVertical: 'top',
    backgroundColor: '#0d0d0d',
  },

  // ── Error banner ────────────────────────────────────────────────────────
  errorBanner: {
    backgroundColor: '#2a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#5a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#f44336',
  },

  // ── Action bar ──────────────────────────────────────────────────────────
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    backgroundColor: '#111',
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  cancelButton: {
    borderRightWidth: 1,
    borderRightColor: '#2a2a2a',
  },
  cancelButtonText: {
    fontFamily: MONO,
    fontSize: 15,
    color: '#888',
  },
  saveButton: {
    backgroundColor: '#1a3a1a',
  },
  saveButtonDisabled: {
    backgroundColor: '#111',
  },
  saveButtonText: {
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 'bold',
    color: '#4caf50',
  },
});
