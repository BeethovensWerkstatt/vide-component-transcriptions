/**
 * VideTranscrPanels
 *
 * Custom element that renders three vertically-stacked OpenSeadragon viewer
 * regions, each with a label. Images are loaded via loadPageImage() using
 * the page object from a genDesc writingZones entry.
 *
 * Controls (zoom buttons, home, fullscreen, rotation) are all suppressed so
 * the panels present as clean image viewports.
 */

// OSD is loaded as a plain script (non-module) into window.OpenSeadragon via
// the dist/vendor copy; import is therefore done lazily.

const OSD_OPTIONS = {
  // Navigation controls – all hidden
  showNavigator: false,
  showNavigationControl: false,
  showHomeControl: false,
  showZoomControl: false,
  showFullPageControl: false,
  showRotationControl: false,
  showSequenceControl: false,

  // Interaction
  gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false },
  gestureSettingsTouch: { pinchToZoom: true },

  // Visual
  background: '#f5f5f5',
  animationTime: 0.4,
  blendTime: 0.1,
  constrainDuringPan: false,
  visibilityRatio: 0.5,

  // Use multi-image mode (addTiledImage); start with no sources
  tileSources: [],
  silenceMultiImageWarnings: true
}

const PANEL_LABELS = ['Transkription 1', 'Transkription 2', 'Transkription 3']

/**
 * Parse a IIIF image URL that may carry a #xywh=x,y,w,h&rotate=r fragment.
 * @param {string} imageUrl
 * @returns {{ target: string, xywh: {x:number,y:number,w:number,h:number}, rotation: number }}
 */
function parseImageUrl (imageUrl) {
  const hashIdx = imageUrl.indexOf('#')
  const target = hashIdx >= 0 ? imageUrl.slice(0, hashIdx) : imageUrl
  const fragment = hashIdx >= 0 ? imageUrl.slice(hashIdx + 1) : ''
  const sp = new URLSearchParams(fragment)
  const [x, y, w, h] = (sp.get('xywh') || '0,0,0,0').split(',').map(Number)
  const rotation = parseFloat(sp.get('rotate') || '0')
  return { target, xywh: { x, y, w, h }, rotation }
}

export class VideTranscrPanels extends HTMLElement {
  constructor () {
    super()
    /** @type {OpenSeadragon.Viewer[]} */
    this.viewers = []
    // Resolves once OSD viewers have been created
    this._readyResolve = null
    this._ready = new Promise(res => { this._readyResolve = res })
  }

  connectedCallback () {
    this.render()
    // Defer OSD init until the DOM is painted so container dimensions are known
    requestAnimationFrame(() => this._initViewers())
  }

  disconnectedCallback () {
    this.viewers.forEach(v => v.destroy())
    this.viewers = []
    // Reset the ready promise in case the element is re-connected
    this._ready = new Promise(res => { this._readyResolve = res })
  }

  render () {
    this.innerHTML = `
      <header class="transcr-panels-header">
        <span class="transcr-panels-title"></span>
      </header>
      <div class="transcr-panels-container">
        ${[0, 1, 2].map(i => `
          <div class="transcr-panel-wrapper">
            <h3 class="transcr-panel-label">${PANEL_LABELS[i]}</h3>
            <div class="transcr-panel" id="transcr-panel-${i}"></div>
          </div>
        `).join('')}
      </div>
    `
  }

  /** Set the main heading text shown above the three panels (e.g. "NK 1/1"). */
  setTitle (title) {
    const el = this.querySelector('.transcr-panels-title')
    if (el) el.textContent = title
  }

  _initViewers () {
    const OSD = window.OpenSeadragon
    if (!OSD) {
      // Script still loading; retry shortly
      setTimeout(() => this._initViewers(), 50)
      return
    }

    this.viewers = [0, 1, 2].map(i => {
      const el = this.querySelector(`#transcr-panel-${i}`)
      return new OSD({ ...OSD_OPTIONS, element: el })
    })

    this._readyResolve()
  }

  /**
   * Calculate OSD world-space placement for a page image.
   * The page object is genDesc.writingZones[n].page.
   * World units are millimetres; the page occupies [0, mmWidth] × [0, mmHeight].
   *
   * @param {{ image: string, px: {width:number,height:number}, mm: {width:number,height:number} }} page
   * @returns {{ tileSource: string, x: number, y: number, width: number, degrees: number }}
   */
  calculatePagePosition (page) {
    const { target, xywh, rotation } = parseImageUrl(page.image)
    const { width: pxWidth } = page.px
    const { width: mmWidth, height: mmHeight } = page.mm

    // Scale factor: how many mm per full-image pixel
    const mmPerPx = mmWidth / xywh.w
    const fullImageWidthMm = pxWidth * mmPerPx

    // Centre of the xywh crop in mm world coordinates
    const xywhCenterMmX = (xywh.x + xywh.w / 2) * mmPerPx
    const xywhCenterMmY = (xywh.y + xywh.h / 2) * mmPerPx

    // Place image so the xywh crop centre aligns with the page centre
    const imageX = mmWidth / 2 - xywhCenterMmX
    const imageY = mmHeight / 2 - xywhCenterMmY

    const tileSource = target.replace(/\.(jpg|tif|tiff)$/i, '') + '/info.json'

    return { tileSource, x: imageX, y: imageY, width: fullImageWidthMm, degrees: -rotation }
  }

  /**
   * Load a writing-zone page image into one of the three panels.
   * Waits for OSD to be initialised before proceeding.
   *
   * @param {number} panelIndex  0, 1, or 2
   * @param {{ image: string, px: {width:number,height:number}, mm: {width:number,height:number} }} page
   */
  async loadPageImage (panelIndex, page) {
    await this._ready
    const viewer = this.viewers[panelIndex]
    if (!viewer) return

    const { tileSource, x, y, width, degrees } = this.calculatePagePosition(page)
    const OSD = window.OpenSeadragon

    viewer.addTiledImage({
      tileSource,
      x,
      y,
      width,
      degrees,
      success: () => {
        viewer.viewport.fitBounds(
          new OSD.Rect(0, 0, page.mm.width, page.mm.height),
          true
        )
      }
    })
  }
}
