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

const PANEL_LABELS = ['Faksimile', 'Diplomatische Transkription', 'Annotierte Transkription']

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
    this._ready = new Promise(resolve => { this._readyResolve = resolve })
    // Cross-panel highlighting
    this._shapeLinks = null // { dtId: [shapeId] } from API
    this._atLinks = null // { atId: dtId }     from API (dtLinks in JSON)
    this._shapesSvgEl = null // live <svg> from loadShapesOverlay
    this._dtSvgEl = null // live <svg> from loadRenderedWzOverlay
    this._atSvgEl = null // live <svg> from loadSvg
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
    this._ready = new Promise(resolve => { this._readyResolve = resolve })
    this._shapeLinks = null
    this._atLinks = null
    this._shapesSvgEl = null
    this._dtSvgEl = null
    this._atSvgEl = null
  }

  render () {
    this.innerHTML = `
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

    // Keep panels 0 and 1 in sync with each other
    this._linkViewers(0, 1)

    this._readyResolve()
  }

  /**
   * Bidirectionally synchronise two OSD viewers: panning or zooming one
   * immediately mirrors the action in the other.
   * @param {number} a  panel index
   * @param {number} b  panel index
   */
  _linkViewers (a, b) {
    const viewers = this.viewers
    // -1 means no panel is active; set to a viewer index when pointer is over it
    let activePanel = -1

    ;[a, b].forEach(idx => {
      const el = this.querySelector(`#transcr-panel-${idx}`)

      el.addEventListener('pointerenter', () => { activePanel = idx })

      el.addEventListener('pointerleave', (e) => {
        // During a drag OSD holds pointer capture, so the pointer can leave the
        // panel's hit-test area while the button is still down.  Keep the panel
        // active until the gesture actually ends (buttons === 0).
        if (e.buttons === 0 && activePanel === idx) activePanel = -1
      })

      // Pointer released inside or outside the panel
      el.addEventListener('pointerup', () => { if (activePanel === idx) activePanel = -1 })
      el.addEventListener('pointercancel', () => { if (activePanel === idx) activePanel = -1 })
    })

    const makeHandler = (srcIdx, tgtIdx) => () => {
      // Only sync when the pointer is actually over the source panel.
      // This prevents the target's own update-viewport (fired because we just
      // moved it) from bouncing the position back to the source.
      if (activePanel !== srcIdx) return
      const src = viewers[srcIdx].viewport
      const tgt = viewers[tgtIdx].viewport
      tgt.panTo(src.getCenter(true), true)
      tgt.zoomTo(src.getZoom(true), null, true)
    }

    viewers[a].addHandler('update-viewport', makeHandler(a, b))
    viewers[b].addHandler('update-viewport', makeHandler(b, a))
  }

  /**
   * Fetch the renderedWz SVG and add it as a live-DOM OSD overlay on the given
   * panel, co-registered with the facsimile image – including any IIIF rotation.
   *
   * The DT SVG's internal coordinate space covers the writing-zone crop in mm.
   * We map that crop to OSD world space with the same rotation applied to the
   * tiled image, so the overlay stays pixel-accurate at all zoom levels.
   *
   * @param {number} panelIndex
   * @param {string} svgUrl
   * @param {{ image:string, px:{width:number,height:number}, mm:{width:number,height:number} }} page
   */
  async loadRenderedWzOverlay (panelIndex, svgUrl, page) {
    if (!svgUrl) return
    await this._ready
    const viewer = this.viewers[panelIndex]
    if (!viewer) return

    const res = await fetch(svgUrl)
    if (!res.ok) throw new Error(`renderedWz fetch failed: ${res.status} ${res.statusText} — ${svgUrl}`)
    const svgText = await res.text()

    const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const parseError = svgDoc.querySelector('parsererror')
    if (parseError) throw new Error(`renderedWz SVG parse error: ${parseError.textContent}`)

    const svgEl = svgDoc.documentElement

    // Preserve the SVG's natural viewBox (its internal coordinate space).
    // Make it fill whatever container OSD gives it.
    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    svgEl.setAttribute('preserveAspectRatio', 'none')
    svgEl.style.cssText = 'display:block'
    svgEl.classList.add('renderedWz')

    // OSD manages this wrapper div: it sets its CSS position/size to match the
    // world-space rect at every viewport change. The SVG inside scales with it.
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden'
    wrapper.appendChild(svgEl)

    const OSD = window.OpenSeadragon

    // Determine the world-space placement of the crop (xywh), applying the same
    // rotation that loadPageImage applies to the tiled image.
    // For rotation=0 this reduces to OSD.Rect(0, 0, mm.width, mm.height).
    const { xywh } = parseImageUrl(page.image)
    const pos = this.calculatePagePosition(page)
    const { x: imgX, y: imgY, degrees, mmPerPx } = pos
    const { width: mmWidth, height: mmHeight } = page.mm
    const rad = degrees * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const lx = xywh.x * mmPerPx
    const ly = xywh.y * mmPerPx
    const cropX = imgX + lx * cos - ly * sin
    const cropY = imgY + lx * sin + ly * cos

    viewer.addOverlay({
      element: wrapper,
      location: new OSD.Rect(cropX, cropY, mmWidth, mmHeight, degrees),
      checkResize: false
    })

    this._dtSvgEl = svgEl
    this._tryInitHighlighting()
  }

  /**
   * Fetch an SVG and inject it as live DOM nodes into the given panel,
   * replacing the OSD viewer for that panel.  The SVG remains fully
   * accessible to JavaScript (querySelector, addEventListener, etc.).
   * Pan and zoom are handled with native pointer + wheel events.
   *
   * @param {number} panelIndex  0, 1, or 2
   * @param {string} svgUrl
   */
  async loadSvg (panelIndex, svgUrl) {
    await this._ready

    // Tear down the OSD viewer for this panel — it would rasterise the SVG
    const viewer = this.viewers[panelIndex]
    if (viewer) {
      viewer.destroy()
      this.viewers[panelIndex] = null
    }

    const panelEl = this.querySelector(`#transcr-panel-${panelIndex}`)
    if (!panelEl) return

    const res = await fetch(svgUrl)
    if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText} — ${svgUrl}`)
    const svgText = await res.text()

    const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const parseError = svgDoc.querySelector('parsererror')
    if (parseError) throw new Error(`SVG parse error: ${parseError.textContent}`)

    const svgEl = svgDoc.documentElement

    // Read natural dimensions from viewBox first (most reliable), then attributes
    const vb = svgEl.viewBox?.baseVal
    const svgNaturalWidth = (vb && vb.width > 0) ? vb.width : (parseFloat(svgEl.getAttribute('width')) || 800)
    const svgNaturalHeight = (vb && vb.height > 0) ? vb.height : (parseFloat(svgEl.getAttribute('height')) || 600)

    // Pin the SVG to its coordinate-space dimensions so transform:scale() is the
    // sole driver of rendered size (avoids fights with CSS percentage sizing)
    svgEl.setAttribute('width', svgNaturalWidth)
    svgEl.setAttribute('height', svgNaturalHeight)
    svgEl.style.cssText = 'display:block;transform-origin:0 0;user-select:none'
    svgEl.classList.add('atTranscription')

    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;cursor:grab'
    wrapper.appendChild(svgEl)
    panelEl.innerHTML = ''
    panelEl.appendChild(wrapper)

    // --- pan / zoom state ---
    // scale = 1 means the SVG renders at its natural coordinate-space size.
    // initialScale makes the SVG fill the container height ("100%").
    // MIN_SCALE → 50% of that; MAX_SCALE → 500% of that (5×).
    const initialScale = wrapper.clientHeight / svgNaturalHeight
    const MIN_SCALE = 0.5 * initialScale
    const MAX_SCALE = 5.0 * initialScale
    let tx = 0; let ty = 0; let scale = initialScale
    let dragStartX = 0; let dragStartY = 0; let dragStartTx = 0; let dragStartTy = 0

    const applyTransform = () => {
      svgEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`
    }

    applyTransform() // render at initial scale immediately

    // Zoom around the pointer position
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault()
      const rawFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * rawFactor))
      // Derive the actual factor after clamping so tx/ty stay consistent
      const factor = newScale / scale
      if (factor === 1) return // already at a limit, nothing to do
      const rect = wrapper.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      tx = mx - factor * (mx - tx)
      ty = my - factor * (my - ty)
      scale = newScale
      applyTransform()
    }, { passive: false })

    // Drag to pan
    wrapper.addEventListener('pointerdown', (e) => {
      wrapper.setPointerCapture(e.pointerId)
      wrapper.style.cursor = 'grabbing'
      dragStartX = e.clientX; dragStartY = e.clientY
      dragStartTx = tx; dragStartTy = ty
    })

    wrapper.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) return
      tx = dragStartTx + (e.clientX - dragStartX)
      ty = dragStartTy + (e.clientY - dragStartY)
      applyTransform()
    })

    wrapper.addEventListener('pointerup', () => { wrapper.style.cursor = 'grab' })
    wrapper.addEventListener('pointercancel', () => { wrapper.style.cursor = 'grab' })

    this._atSvgEl = svgEl
    this._tryInitHighlighting()
  }

  /**
   * Store the dtId→shapeIds map from the API. Triggers highlighting setup once
   * all three SVGs have also loaded.
   * @param {Object<string, string[]>} shapeLinks
   */
  setShapeLinks (shapeLinks) {
    this._shapeLinks = shapeLinks
    this._tryInitHighlighting()
  }

  setAtLinks (atLinks) {
    this._atLinks = atLinks
    this._tryInitHighlighting()
  }

  _tryInitHighlighting () {
    if (this._shapeLinks && this._shapesSvgEl && this._dtSvgEl && this._atSvgEl) {
      this._initHighlighting()
    }
  }

  /**
   * Build a cross-panel element index from the three live SVGs + shapeLinks/atLinks,
   * then attach mouseenter/mouseleave handlers for hover highlighting.
   *
   * Index is built once; hover callbacks are O(k) where k = linked elements.
   *
   * ID spaces:
   *   shapes SVG  – element `id`       matches shapeLinks values
   *   DT SVG      – element `data-id`  matches shapeLinks keys (= atLinks values)
   *   AT SVG      – element `data-id`  matches atLinks keys
   */
  _initHighlighting () {
    const shapeLinks = this._shapeLinks // { dtId: [shapeId] }
    const atLinks = this._atLinks // { atId: dtId } — optional
    const shapesSvg = this._shapesSvgEl
    const dtSvg = this._dtSvgEl
    const atSvg = this._atSvgEl

    // byDtId: dtId → { dtEls, shapeEls, atEls } — all sets of live DOM elements
    const byDtId = new Map()
    const ensure = (dtId) => {
      if (!byDtId.has(dtId)) {
        byDtId.set(dtId, { dtEls: new Set(), shapeEls: new Set(), atEls: new Set() })
      }
      return byDtId.get(dtId)
    }

    // Populate from shapeLinks: DT elements and their linked shape elements
    for (const [dtId, shapeIds] of Object.entries(shapeLinks)) {
      const entry = ensure(dtId)
      dtSvg.querySelectorAll(`[data-id="${dtId}"]`).forEach(el => entry.dtEls.add(el))
      for (const sid of shapeIds) {
        const el = shapesSvg.getElementById(sid)
        if (el) entry.shapeEls.add(el)
      }
    }

    // Populate AT elements linked via atLinks (JSON): atId → dtId | [dtId, ...]
    if (atLinks) {
      for (const [atId, dtIds] of Object.entries(atLinks)) {
        const dtIdArray = Array.isArray(dtIds) ? dtIds : [dtIds]
        const atEls = Array.from(atSvg.querySelectorAll(`[data-id="${atId}"]`))
        for (const dtId of dtIdArray) {
          const entry = ensure(dtId)
          atEls.forEach(el => entry.atEls.add(el))
        }
      }
    }

    // Reverse map: element → precomputed array of all linked elements
    // (an element may link to multiple dtIds if a shape appears in multiple)
    const elToLinked = new Map()
    for (const [, { dtEls, shapeEls, atEls }] of byDtId) {
      const all = [...dtEls, ...shapeEls, ...atEls]
      for (const el of all) {
        if (!elToLinked.has(el)) elToLinked.set(el, new Set())
        for (const e of all) elToLinked.get(el).add(e)
      }
    }

    // Attach hover handlers — O(k) per event, no DOM scanning at runtime
    for (const [el, linked] of elToLinked) {
      const arr = [...linked]
      el.addEventListener('mouseenter', () => arr.forEach(e => e.classList.add('highlighted')))
      el.addEventListener('mouseleave', () => arr.forEach(e => e.classList.remove('highlighted')))
    }
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
    const degrees = -rotation

    return { tileSource, x: imageX, y: imageY, width: fullImageWidthMm, degrees, mmPerPx }
  }

  /**
   * Convert a pixel-space writing-zone rect into an OSD world-space (mm) Rect,
   * applying the image rotation and offset.
   *
   * @param {{ x:number, y:number, w:number, h:number }} rect  full-image px coordinates
   * @param {{ x:number, y:number, degrees:number, mmPerPx:number }} pos  from calculatePagePosition
   * @returns {OpenSeadragon.Rect}
   */
  calculateRectBounds (rect, pos) {
    const OSD = window.OpenSeadragon
    const { x: imgX, y: imgY, degrees, mmPerPx } = pos
    const rad = degrees * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    // Transform all four corners from px → image-local mm → rotated world mm
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h]
    ].map(([px, py]) => {
      const lx = px * mmPerPx
      const ly = py * mmPerPx
      return {
        x: imgX + lx * cos - ly * sin,
        y: imgY + lx * sin + ly * cos
      }
    })

    const xs = corners.map(c => c.x)
    const ys = corners.map(c => c.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const w = Math.max(...xs) - minX
    const h = Math.max(...ys) - minY

    // Add 10% padding on each side
    const pw = w * 0.1
    const ph = h * 0.1
    return new OSD.Rect(minX - pw, minY - ph, w + 2 * pw, h + 2 * ph)
  }

  /**
   * Fetch the shapes SVG for a page and add it as a live-DOM OSD overlay on
   * the given panel, perfectly co-registered with the facsimile image.
   *
   * The SVG's coordinate space is the full image pixel grid (px.width × px.height).
   * OSD scales and positions the overlay element to match the tiled image exactly,
   * so all child elements are addressable and interactive via normal DOM APIs.
   *
   * @param {number} panelIndex
   * @param {{ shapes: string, shapesGroupId?: string, px: {width:number,height:number},
   *           image: string, mm: {width:number,height:number} }} page
   */
  async loadShapesOverlay (panelIndex, page) {
    if (!page.shapes) return
    await this._ready
    const viewer = this.viewers[panelIndex]
    if (!viewer) return

    const res = await fetch(page.shapes)
    if (!res.ok) throw new Error(`Shapes fetch failed: ${res.status} ${res.statusText} — ${page.shapes}`)
    const svgText = await res.text()

    const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const parseError = svgDoc.querySelector('parsererror')
    if (parseError) throw new Error(`Shapes SVG parse error: ${parseError.textContent}`)

    const svgEl = svgDoc.documentElement

    // Pin the SVG's coordinate space to the full image pixel grid so every
    // shape coordinate maps 1:1 with the underlying IIIF image pixels.
    const { width: pxWidth, height: pxHeight } = page.px
    svgEl.setAttribute('viewBox', `0 0 ${pxWidth} ${pxHeight}`)
    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    // Override any baked-in preserveAspectRatio (e.g. "xMidYMid meet") so the
    // SVG fills its OSD overlay container edge-to-edge rather than centering
    // itself — otherwise pixel-rounding of the container causes a positional offset.
    svgEl.setAttribute('preserveAspectRatio', 'none')
    svgEl.classList.add('pageShapes')

    if (page.shapesGroupId) {
      const groupEl = svgEl.getElementById(page.shapesGroupId)
      if (groupEl) groupEl.classList.add('active')
    }

    // World-space rect that matches the tiled image placement exactly.
    // pos.width = fullImageWidthMm; derive height from the same mmPerPx factor.
    const pos = this.calculatePagePosition(page)
    const fullImageHeightMm = pxHeight * pos.mmPerPx
    const OSD = window.OpenSeadragon

    // OSD silently drops Rect.degrees for overlays (it's stripped in Overlay._init).
    // OSD also clears transform on the element we pass to addOverlay on every viewport
    // update. So: pass a wrapper div as the OSD element, then apply the CSS rotation
    // to the SVG inside — OSD won't touch it.
    // transform-origin:0 0 pivots around the overlay div's CSS top-left, which
    // corresponds to world (pos.x, pos.y) — exactly the same pivot OSD uses for
    // the tiled image. This co-registers the shapes with the tilted facsimile.
    svgEl.style.cssText = `display:block;overflow:visible;transform:rotate(${pos.degrees}deg);transform-origin:50% 50%`
    const shapesWrapper = document.createElement('div')
    shapesWrapper.style.cssText = 'width:100%;height:100%;overflow:visible'
    shapesWrapper.appendChild(svgEl)

    viewer.addOverlay({
      element: shapesWrapper,
      location: new OSD.Rect(pos.x, pos.y, pos.width, fullImageHeightMm, pos.degrees),
      checkResize: false
    })

    this._shapesSvgEl = svgEl
    this._tryInitHighlighting()
  }

  /**
   * Load a writing-zone page image into one of the three panels.
   * Waits for OSD to be initialised before proceeding.
   *
   * @param {number} panelIndex  0, 1, or 2
   * @param {{ image: string, px: {width:number,height:number}, mm: {width:number,height:number} }} page
   * @param {{ rect?: {x:number,y:number,w:number,h:number}, opacity?: number }} [options]
   */
  async loadPageImage (panelIndex, page, { rect = null, opacity = 1 } = {}) {
    await this._ready
    const viewer = this.viewers[panelIndex]
    if (!viewer) return

    const pos = this.calculatePagePosition(page)
    const { tileSource, x, y, width, degrees } = pos
    const OSD = window.OpenSeadragon

    viewer.addTiledImage({
      tileSource,
      x,
      y,
      width,
      degrees,
      success: ({ item }) => {
        if (opacity !== 1) item.setOpacity(opacity)
        const bounds = rect
          ? this.calculateRectBounds(rect, pos)
          : new OSD.Rect(0, 0, page.mm.width, page.mm.height)
        viewer.viewport.fitBounds(bounds, true)
      }
    })
  }
}
