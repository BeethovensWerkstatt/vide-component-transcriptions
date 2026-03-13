import { fetchCached } from './data-cache.js'

const API_BASE = 'http://localhost:8080/exist/apps/api/document'

// Map of short document IDs used in URLs to their overview endpoint
const DOCUMENTS = {
  NK: `${API_BASE}/m57bab171-9222-451d-8f7d-7fe7db6064bb/overview.json`
}

/**
 * VideTranscrRouter
 * Client-side router using the History API for the Transcriptions SPA island.
 * Handles navigation between different transcription views.
 */
export class VideTranscrRouter {
  constructor(appElement) {
    this.basePath = '/transcr';
    this.app = appElement;
    this.contentEl = appElement.querySelector('vide-transcr-content');

    if (!this.contentEl) {
      console.error('[VideTranscr] Content component not found');
      return;
    }

    this.init();
  }

  init() {
    // Eagerly prefetch all known overview documents into the cache
    Object.values(DOCUMENTS).forEach(url => fetchCached(url).catch(() => {}))

    // Check for ?_path parameter (from 404 redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const pathParam = urlParams.get('_path');

    if (pathParam) {
      const cleanUrl = this.basePath + pathParam;
      history.replaceState({ path: pathParam }, '', cleanUrl);
      this.route(pathParam);
    } else {
      this.route(this.getCurrentPath());
    }

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => {
      this.route(this.getCurrentPath());
    });

    // Intercept clicks on SPA links
    this.app.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-spa-link]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href');
        const path = href.replace(this.basePath, '') || '/';
        history.pushState({ path }, '', href);
        this.route(path);
      }
    });
  }

  getCurrentPath() {
    const fullPath = window.location.pathname;
    if (fullPath.startsWith(this.basePath)) {
      return fullPath.slice(this.basePath.length) || '/';
    }
    return '/';
  }

  /**
   * Route to the given path and render the appropriate view.
   *
   * URL patterns:
   *   /transcr/              → home
   *   /transcr/NK/           → document overview
   *   /transcr/NK/wz1.1/    → writing zone view (page 1, zone 1, both 1-based)
   */
  route(path) {
    const segments = path.split('/').filter(Boolean);

    if (segments.length === 0) {
      this.renderHome();
      return;
    }

    const docId = segments[0];
    if (!DOCUMENTS[docId]) {
      this.renderNotFound(path);
      return;
    }

    if (segments.length === 1) {
      this.loadDocument(docId);
      return;
    }

    // segments[1] expected to be e.g. "wz1.1"
    const wzSpec = segments[1];
    this.loadWritingZone(docId, wzSpec);
  }

  /**
   * Load and display a document overview.
   * @param {string} docId  e.g. 'NK'
   */
  async loadDocument(docId) {
    this.contentEl.setContent(`
      <div class="transcr-loading"><p>Lade Dokument <code>${this.escapeHtml(docId)}</code> …</p></div>
    `);
    const overviewUrl = DOCUMENTS[docId];
    try {
      const data = await fetchCached(overviewUrl);
      const sourceData = data[0];
      this.currentEdition = sourceData;
      const { id, title, source } = sourceData;
      const wzCount = source.pages.reduce((n, p) => n + (p.writingZones?.length ?? 0), 0);
      this.contentEl.setContent(`
        <div class="transcr-document">
          <h2>${this.escapeHtml(title)}</h2>
          <p><code>${this.escapeHtml(id)}</code></p>
          <p>${source.pages.length} Seiten · ${wzCount} Schreibzonen</p>
        </div>
      `);
    } catch (err) {
      this.renderError(`Fehler beim Laden von ${this.escapeHtml(overviewUrl)}`, err);
    }
  }

  /**
   * Parse a writing-zone spec like "wz3.2" into {pageIndex, wzIndex} (0-based).
   * Returns null if the spec is malformed.
   * @param {string} wzSpec
   * @returns {{pageIndex: number, wzIndex: number}|null}
   */
  parseWzSpec(wzSpec) {
    const match = wzSpec.match(/^wz(\d+)\.(\d+)$/);
    if (!match) return null;
    return { pageIndex: parseInt(match[1], 10) - 1, wzIndex: parseInt(match[2], 10) - 1 };
  }

  /**
   * Load the writing zone identified by docId + wzSpec, fetch its genDesc JSON,
   * and render the result.
   * @param {string} docId   e.g. 'NK'
   * @param {string} wzSpec  e.g. 'wz1.1'
   */
  async loadWritingZone(docId, wzSpec) {
    this.contentEl.setContent(`
      <div class="transcr-loading"><p>Lade Schreibzone <code>${this.escapeHtml(wzSpec)}</code> …</p></div>
    `);

    const coords = this.parseWzSpec(wzSpec);
    if (!coords) {
      this.renderError(`Ungültiger Schreibzonen-Bezeichner: ${this.escapeHtml(wzSpec)}`);
      return;
    }

    const overviewUrl = DOCUMENTS[docId];
    try {
      const data = await fetchCached(overviewUrl);
      const pages = data[0].source.pages;

      const page = pages[coords.pageIndex];
      if (!page) {
        this.renderError(`Seite ${coords.pageIndex + 1} nicht gefunden (Dokument hat ${pages.length} Seiten).`);
        return;
      }

      const wz = page.writingZones?.[coords.wzIndex];
      if (!wz) {
        this.renderError(`Schreibzone ${coords.wzIndex + 1} auf Seite ${coords.pageIndex + 1} nicht gefunden.`);
        return;
      }

      const genDescId = wz.identifier?.genDescId;
      if (!genDescId) {
        this.renderError(`Keine genDescId für ${this.escapeHtml(wzSpec)}.`);
        return;
      }

      const genDescUrl = `${API_BASE}/genDesc/${genDescId}.json`;
      const genDescData = await fetchCached(genDescUrl);

      this.contentEl.setContent(`
        <div class="transcr-gendesc">
          <h2>${this.escapeHtml(docId)} · ${this.escapeHtml(wzSpec)}</h2>
          <p>Seite <strong>${this.escapeHtml(page.surfaceLabel)}</strong>
             (${this.escapeHtml(page.position)}),
             Schreibzone <strong>${this.escapeHtml(wz.label)}</strong>
             — genDescId: <code>${this.escapeHtml(genDescId)}</code></p>
          <pre class="transcr-json">${this.escapeHtml(JSON.stringify(genDescData, null, 2))}</pre>
        </div>
      `);
    } catch (err) {
      this.renderError(`Fehler beim Laden`, err);
    }
  }

  renderHome() {
    this.contentEl.setContent(`
      <div class="transcr-home">
        <h2>Transkriptionen</h2>
        <p>Wählen Sie ein Werk, um die Transkriptionen anzuzeigen.</p>
      </div>
    `);
  }

  renderNotFound(path) {
    this.contentEl.setContent(`
      <div class="transcr-error">
        <h2>Nicht gefunden</h2>
        <p>Kein Dokument für Pfad <code>${this.escapeHtml(path)}</code> gefunden.</p>
      </div>
    `);
  }

  /**
   * @param {string} message
   * @param {Error} [err]
   */
  renderError(message, err) {
    this.contentEl.setContent(`
      <div class="transcr-error">
        <h2>Fehler</h2>
        <p>${this.escapeHtml(message)}</p>
        ${err ? `<pre>${this.escapeHtml(String(err))}</pre>` : ''}
      </div>
    `);
  }

  /**
   * Escape HTML to prevent XSS when rendering user-controlled path segments.
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Navigate programmatically to a document overview.
   * @param {string} docId  e.g. 'NK'
   */
  navigateTo(docId) {
    const path = `/${docId}`;
    history.pushState({ path }, '', this.basePath + path);
    this.route(path);
  }

  /**
   * Navigate programmatically to a specific writing zone.
   * @param {string} docId   e.g. 'NK'
   * @param {number} page    1-based page number
   * @param {number} wz      1-based writing-zone number
   */
  navigateToWz(docId, page, wz) {
    const path = `/${docId}/wz${page}.${wz}`;
    history.pushState({ path }, '', this.basePath + path);
    this.route(path);
  }

  /**
   * Navigate programmatically to a document overview.
   * @param {string} docId  e.g. 'NK'
   */
  navigateTo(docId) {
    const path = `/${docId}`;
    history.pushState({ path }, '', this.basePath + path);
    this.route(path);
  }

  /**
   * Navigate programmatically to a specific writing zone.
   * @param {string} docId   e.g. 'NK'
   * @param {number} page    1-based page number
   * @param {number} wz      1-based writing-zone number
   */
  navigateToWz(docId, page, wz) {
    const path = `/${docId}/wz${page}.${wz}`;
    history.pushState({ path }, '', this.basePath + path);
    this.route(path);
  }
}
