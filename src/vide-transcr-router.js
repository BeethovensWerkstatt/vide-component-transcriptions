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

      // Fetch genDesc data (cached)
      const genDescUrl = `${API_BASE}/genDesc/${genDescId}.json`;
      const genDescData = await fetchCached(genDescUrl);

      // Mount the three-panel OSD viewer
      this.contentEl.setContent(`
        <div class="transcr-wz-view">
          <vide-transcr-panels></vide-transcr-panels>
          <div class="side-panel" id="side-panel">
            <div class="side-panel-tabs">
              <button class="side-panel-tab active" data-panel="info">
                <span class="tab-label">Info</span>
              </button>
            </div>
            <div class="side-panel-content" id="side-panel-content">
              <header class="transcription-header">
                <span class="transcription-header-title">Hallo</span>
              </header>
              <div class="panel-section active" data-panel="info"></div>
            </div>
          </div>
        </div>
      `);

      this.setupSidePanel();

      // Build ordered list of all overview zones that share this genDescId.
      // Their position in this list (document order) maps 1:1 to genDescData.writingZones[i].
      const wzOccurrences = [];
      pages.forEach((pg, pi) => {
        (pg.writingZones || []).forEach((z, wi) => {
          if (z.identifier?.genDescId === genDescId) {
            wzOccurrences.push({ pageIndex: pi, wzIndex: wi, label: z.label ?? String(wi + 1) });
          }
        });
      });

      // Which occurrence does the current URL address?
      const activeOccIdx = Math.max(
        wzOccurrences.findIndex(o => o.pageIndex === coords.pageIndex && o.wzIndex === coords.wzIndex),
        0
      );

      this.populateWzMetadata(wz, { docId, wzOccurrences, activeOccIdx });

      const panelsEl = this.contentEl.querySelector('vide-transcr-panels');

      // Set the title in the side-panel header (lives outside <vide-transcr-panels>)
      const headerTitle = this.contentEl.querySelector('.transcription-header-title');
      if (headerTitle) headerTitle.textContent = `${docId} ${coords.pageIndex + 1}/${coords.wzIndex + 1}`;

      // Panel 0: facsimile zoomed to the writing-zone rect, full opacity
      // Panel 1: same facsimile, 50% opacity (overlay comparison use case)
      // Panel 2: annotated transcription SVG as live DOM nodes
      const writingZones = genDescData.writingZones ?? [];
      // Use the occurrence index so the correct zone is shown, not always [0]
      const activeWz = writingZones[activeOccIdx] ?? writingZones[0];
      if (activeWz) {
        if (activeWz.shapeLinks) panelsEl.setShapeLinks(activeWz.shapeLinks);
        const rect = activeWz.rect ?? null;
        panelsEl.loadPageImage(0, activeWz.page, { rect });
        panelsEl.loadShapesOverlay(0, activeWz.page);
        panelsEl.loadPageImage(1, activeWz.page, { rect, opacity: 0.5 });
        if (activeWz.renderedWz) panelsEl.loadRenderedWzOverlay(1, activeWz.renderedWz, activeWz.page.mm);
      }

      const atData = genDescData.at ?? {};
      if (atData.dtLinks) panelsEl.setAtLinks(atData.dtLinks);
      if (atData.renderedSvg) panelsEl.loadSvg(2, atData.renderedSvg);
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
  /**
   * Wire up the side-panel tab toggle / collapse behaviour.
   * Mirrors the same pattern used in vide-component-facsimile.
   */
  setupSidePanel() {
    const sidePanel = this.contentEl.querySelector('#side-panel');
    const tabs = this.contentEl.querySelectorAll('.side-panel-tab');
    if (!sidePanel || !tabs.length) return;

    let wasOpen = true;
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.classList.contains('active') && wasOpen) {
          sidePanel.classList.add('collapsed');
          wasOpen = false;
        } else {
          sidePanel.classList.remove('collapsed');
          wasOpen = true;
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
        }
      });
    });
  }

  /**
   * Populate the info panel with metadata for the current writing zone.
   * @param {Object} zone  Writing-zone entry from the overview JSON
   * @param {{ docId: string, wzOccurrences: Array, activeOccIdx: number }} [opts]
   */
  populateWzMetadata(zone, opts = {}) {
    const panel = this.contentEl.querySelector('.panel-section[data-panel="info"]');
    if (!panel) return;

    let html = '';

    // Zone navigation list (only rendered when the sketch has multiple zones)
    if (opts.wzOccurrences?.length > 1) {
      html += '<ul class="wz-nav-list">';
      opts.wzOccurrences.forEach((occ, i) => {
        const isActive = i === opts.activeOccIdx;
        const href = `${this.basePath}/${opts.docId}/wz${occ.pageIndex + 1}.${occ.label}/`;
        const label = `Schreibzone ${i + 1} (S. ${occ.pageIndex + 1})`;
        if (isActive) {
          html += `<li class="wz-nav-item active"><span>${label}</span></li>`;
        } else {
          html += `<li class="wz-nav-item"><a href="${href}" data-spa-link>${label}</a></li>`;
        }
      });
      html += '</ul>';
    }

    html += this.createWzMetadata(zone);
    panel.innerHTML = html;
  }

  /**
   * Build metadata HTML for a writing zone object.
   * Mirrors facs createZoneMetadata() but without zone-list navigation.
   * @param {Object} zone
   * @returns {string} HTML string
   */
  createWzMetadata(zone) {
    let html = '<div class="metadata-content">';

    // ── Sketch properties ────────────────────────────────────────────────────
    html += '<div class="metadata-section sketch-properties">';
    html += '<div class="metadata-section-title">Skizze:</div>';

    if (zone.sketchProps) {
      const props = zone.sketchProps;
      html += '<div class="metadata-section-content">';

      html += '<div class="metadata-row">';
      if (props.staves) {
        html += `<span class="metadata-item"><strong>${props.staves}</strong> ${props.staves === 1 ? 'System' : 'Systeme'}</span>`;
      }
      if (props.atMeasures) {
        html += `<span class="metadata-item">~<strong>${props.atMeasures}</strong> ${props.atMeasures === 1 ? 'Takt' : 'Takte'}</span>`;
      }
      html += '</div>';

      html += '<div class="metadata-row">';
      if (props.keySig?.val) {
        const sup = props.keySig.supplied ? ' <span class="supplied-indicator" title="editorisch ergänzt">*</span>' : '';
        html += `<span class="metadata-item">Vorzeichnung: <strong>${this.formatKeySig(props.keySig.val)}</strong>${sup}</span>`;
      }
      if (props.meterSig?.val) {
        const sup = props.meterSig.supplied ? ' <span class="supplied-indicator" title="editorisch ergänzt">*</span>' : '';
        html += `<span class="metadata-item">Taktart: <strong>${props.meterSig.val}</strong>${sup}</span>`;
      }
      if (props.tempo) {
        const sup = props.tempo.supplied ? ' <span class="supplied-indicator" title="editorisch ergänzt">*</span>' : '';
        html += `<span class="metadata-item">Tempo: <strong>${props.tempo.val || '–'}</strong>${sup}</span>`;
      }
      html += '</div>';

      html += '</div>';
    } else {
      html += '<div class="no-sketch-props">–</div>';
    }
    html += '</div>';

    // ── Writing-zone properties ───────────────────────────────────────────────
    html += '<div class="metadata-section wz-properties">';
    html += '<div class="metadata-section-title">Schreibzone:</div>';

    if (zone.wzProps) {
      const wzProps = zone.wzProps;
      html += '<div class="metadata-section-content"><div class="metadata-row">';
      if (wzProps.staves) {
        html += `<span class="metadata-item"><span class="metadata-label">Zeile:</span> <strong>${wzProps.staves}</strong></span>`;
      }
      if (wzProps.layers?.length > 0) {
        const lbl = wzProps.layers.length === 1 ? 'Schreibschicht' : 'Schreibschichten';
        html += `<span class="metadata-item"><span class="metadata-label">${lbl}:</span> <strong>${wzProps.layers.length}</strong></span>`;
      }
      if (wzProps.metaNavigation)    html += `<span class="metadata-item"><span class="metadata-label">Verweiszeichen:</span> <strong>✓</strong></span>`;
      if (wzProps.metaClarification) html += `<span class="metadata-item"><span class="metadata-label">Erläuterungen:</span> <strong>✓</strong></span>`;
      if (wzProps.otherMeta)         html += `<span class="metadata-item"><span class="metadata-label">Sonstige Metatexte:</span> <strong>✓</strong></span>`;
      html += '</div></div>';
    } else {
      html += '<div class="no-wz-props">–</div>';
    }
    html += '</div>';

    // ── Work relations ────────────────────────────────────────────────────────
    html += '<div class="metadata-section work-relations">';
    html += '<div class="metadata-section-title">Mögliche Werkbezüge:</div>';
    html += '<div class="metadata-section-content">';

    if (zone.workRelations?.length > 0) {
      // Group by work (opus + title)
      const grouped = new Map();
      zone.workRelations.forEach(rel => {
        const key = `${rel.opus || ''}|${rel.work || ''}`;
        if (!grouped.has(key)) grouped.set(key, { opus: rel.opus, work: rel.work, targets: [] });
        grouped.get(key).targets.push(rel);
      });

      grouped.forEach(group => {
        html += '<div class="work-relation-item">';
        if (group.opus || group.work) {
          html += '<div class="work-title">';
          if (group.opus) html += `<strong>${this.escapeHtml(group.opus)}</strong> `;
          if (group.work) html += this.escapeHtml(group.work);
          html += '</div>';
        }
        group.targets.forEach(rel => {
          const t = rel.target;
          if (!t) return;
          let text = '';
          const mdivPos = t.mdivPos || t.start?.mdivPos || t.end?.mdivPos;
          const mvt = mdivPos ? `${mdivPos}. Satz` : '';
          if (t.start && t.end) {
            text = mvt ? `${mvt}, T. ${t.start.label}–${t.end.label}` : `T. ${t.start.label}–${t.end.label}`;
          } else if (t.name === 'measure' && t.label) {
            text = mvt ? `${mvt}, T. ${t.label}` : `T. ${t.label}`;
          } else if (t.name === 'mdiv') {
            text = (t.mdivLabel?.trim()) ? t.mdivLabel : (t.label ? `${t.label}. Satz` : mvt);
          }
          if (text) html += `<div class="work-target">${this.escapeHtml(text)}</div>`;
        });
        html += '</div>';
      });
    } else {
      html += '<div class="no-work-relations">–</div>';
    }

    html += '</div></div>';
    html += '</div>'; // .metadata-content
    return html;
  }

  /** Format a key-signature value like '3f' → '3♭', '2s' → '2♯'. */
  formatKeySig(keySig) {
    if (keySig === '0') return '0';
    const match = keySig.match(/^(\d+)([fs])$/);
    if (!match) return keySig;
    return `${match[1]}${match[2] === 'f' ? '♭' : '♯'}`;
  }

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
