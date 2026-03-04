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
   * @param {string} path
   */
  route(path) {
    const segments = path.split('/').filter(Boolean);

    if (segments.length === 0) {
      this.renderHome();
    } else {
      this.renderTranscription(segments[0], segments.slice(1));
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

  /**
   * Render a specific transcription view.
   * @param {string} id - Work or source identifier
   * @param {string[]} params - Additional path segments
   */
  renderTranscription(id, params) {
    this.contentEl.setContent(`
      <div class="transcr-view">
        <h2>Transkription: ${this.escapeHtml(id)}</h2>
        <div class="transcr-panels"></div>
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
   * Navigate programmatically to a transcription.
   * @param {string} id
   */
  navigateTo(id) {
    const path = `/${id}`;
    const url = this.basePath + path;
    history.pushState({ path }, '', url);
    this.route(path);
  }
}
