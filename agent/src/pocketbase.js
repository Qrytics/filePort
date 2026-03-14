/**
 * PocketBase API client for the filePort agent.
 * Handles authentication and CRUD operations on the `files` collection.
 */

const fetch = require('node-fetch');

class PocketBaseClient {
  /**
   * @param {string} baseUrl  – e.g. "http://127.0.0.1:8090"
   * @param {string} email
   * @param {string} password
   */
  constructor(baseUrl, email, password) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    this.token = null;
  }

  // ── Authentication ────────────────────────────────────────────────────────

  async authenticate() {
    const res = await fetch(
      `${this.baseUrl}/api/admins/auth-with-password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: this.email, password: this.password }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PocketBase auth failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    this.token = data.token;
    return this.token;
  }

  _authHeaders() {
    if (!this.token) throw new Error('Not authenticated. Call authenticate() first.');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  // ── Files collection ──────────────────────────────────────────────────────

  /**
   * Upsert a file record by its `path` field.
   * Returns the created/updated record.
   */
  async upsertFile(fileRecord) {
    const existing = await this.getFileByPath(fileRecord.path);

    if (existing) {
      return this.updateFile(existing.id, fileRecord);
    }
    return this.createFile(fileRecord);
  }

  async createFile(fileRecord) {
    const res = await fetch(`${this.baseUrl}/api/collections/files/records`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify(fileRecord),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`createFile failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async updateFile(id, fields) {
    const res = await fetch(
      `${this.baseUrl}/api/collections/files/records/${id}`,
      {
        method: 'PATCH',
        headers: this._authHeaders(),
        body: JSON.stringify(fields),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`updateFile failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async deleteFile(path) {
    const existing = await this.getFileByPath(path);
    if (!existing) return null;

    const res = await fetch(
      `${this.baseUrl}/api/collections/files/records/${existing.id}`,
      { method: 'DELETE', headers: this._authHeaders() }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`deleteFile failed (${res.status}): ${body}`);
    }
    return existing.id;
  }

  /**
   * Fetch a single file record by its normalised path.
   * Returns null if not found.
   */
  async getFileByPath(filePath) {
    const filter = encodeURIComponent(`path="${filePath}"`);
    const res = await fetch(
      `${this.baseUrl}/api/collections/files/records?filter=${filter}&perPage=1`,
      { headers: this._authHeaders() }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getFileByPath failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.items && data.items.length > 0 ? data.items[0] : null;
  }

  /**
   * Return all file records that have been modified on mobile and need syncing.
   */
  async getPendingSyncFiles() {
    const filter = encodeURIComponent('needs_sync=true');
    const res = await fetch(
      `${this.baseUrl}/api/collections/files/records?filter=${filter}&perPage=500`,
      { headers: this._authHeaders() }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getPendingSyncFiles failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.items || [];
  }

  /**
   * Mark a file as successfully synced (clear needs_sync flag).
   */
  async markSynced(id, lastModifiedLocal) {
    return this.updateFile(id, {
      needs_sync: false,
      last_modified_local: lastModifiedLocal,
    });
  }

  /**
   * Return all file records (paged).
   */
  async listFiles(page = 1, perPage = 200) {
    const res = await fetch(
      `${this.baseUrl}/api/collections/files/records?page=${page}&perPage=${perPage}&sort=path`,
      { headers: this._authHeaders() }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`listFiles failed (${res.status}): ${body}`);
    }
    return res.json();
  }
}

module.exports = PocketBaseClient;
