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

const PANEL_LABELS = ['Ansicht 1', 'Ansicht 2', 'Ansicht 3']

const STEP_LABELS = [
  'Digitales Faksimile',
  'Schreibzonenerfassung',
  'Zeichendeutung',
  'Schriftbildnormierung',
  'Lesefolge',
  'Textregulierung',
  'Editorische Ergänzung',
  'Editorische Eingriffe'
]

const STEP_SNAPPING_ATTRIBUTE = 'step-snapping'
const PHASE_CLASSES = Array.from({ length: 8 }, (_, index) => `phase${index + 1}`)

const SINGLE_TRANSCRIPTION_SVG_URL = new URL('../sampleData/D-BNba_MH_60_Engelmann_p029_wz05_reel.svg', import.meta.url).href
const STRUCTURED_SVG_TEXT_CACHE = (window.__BW_TranscriptionsSvgTextCache ??= new Map())

function getImageHref (imageEl) {
  if (!imageEl) return ''
  return imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || imageEl.getAttribute('href') || ''
}

function getUseHref (useEl) {
  if (!useEl) return ''
  return useEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || useEl.getAttribute('href') || ''
}

function getNumericAttr (el, attrName, fallback = 0) {
  if (!el) return fallback
  const raw = el.getAttribute(attrName)
  const value = parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

function parseNumberList (value) {
  return String(value || '')
    .trim()
    .split(/[\s,]+/)
    .map(n => parseFloat(n))
    .filter(n => Number.isFinite(n))
}

function parseViewBox (svgEl) {
  const rawViewBox = svgEl?.getAttribute('viewBox')
  const parts = parseNumberList(rawViewBox)
  if (parts.length === 4) {
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
  }

  const width = parseFloat(svgEl?.getAttribute('width')) || 0
  const height = parseFloat(svgEl?.getAttribute('height')) || 0
  return { x: 0, y: 0, width, height }
}

function extractInlineTransform (el) {
  const style = el?.getAttribute('style') || ''
  const match = style.match(/(?:^|;)\s*transform\s*:\s*([^;]+)/i)
  return match ? match[1].trim() : ''
}

function wrapGroupWithAncestorTransforms (groupEl, stopAtEl) {
  if (!groupEl) return null

  const svgNs = 'http://www.w3.org/2000/svg'
  let wrapped = groupEl.cloneNode(true)
  let current = groupEl.parentElement

  while (current && current !== stopAtEl) {
    const tagName = current.tagName?.toLowerCase()
    const transforms = []

    if (tagName === 'svg') {
      const x = getNumericAttr(current, 'x', 0)
      const y = getNumericAttr(current, 'y', 0)
      if (x !== 0 || y !== 0) transforms.push(`translate(${x} ${y})`)
    }

    const attrTransform = current.getAttribute('transform') || ''
    if (attrTransform) transforms.push(attrTransform)

    const inlineTransform = extractInlineTransform(current)
    if (inlineTransform) transforms.push(inlineTransform)

    if (transforms.length) {
      const wrapper = document.createElementNS(svgNs, 'g')
      wrapper.setAttribute('transform', transforms.join(' '))
      wrapper.appendChild(wrapped)
      wrapped = wrapper
    }

    current = current.parentElement
  }

  return wrapped
}

function cloneShapesSvgForOverlay (shapesSvg) {
  if (!shapesSvg) return null

  const clone = shapesSvg.cloneNode(true)
  clone.removeAttribute('x')
  clone.removeAttribute('y')
  return clone
}

function collectDefsGroup (svgDom) {
  const defsEls = Array.from(svgDom.querySelectorAll('defs'))
  if (!defsEls.length) return null

  const mergedDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')

  defsEls.forEach((defsEl) => {
    Array.from(defsEl.childNodes).forEach((childNode) => {
      mergedDefs.appendChild(childNode.cloneNode(true))
    })
  })

  return mergedDefs.childNodes.length ? mergedDefs : null
}

function extractRotationDeg (value) {
  const match = String(value || '').match(/rotate\(([-\d.]+)(?:deg)?(?:[\s,]+[-\d.]+[\s,]+[-\d.]+)?\)/i)
  return match ? (parseFloat(match[1]) || 0) : 0
}

function toIiifBaseUrl (href) {
  const raw = String(href || '')
  return raw
    .replace(/\/full\/(full|max)\/0\/default\.(jpg|jpeg|png)$/i, '')
    .replace(/\/full\/(full|max)\/0\/default\.(jpg|jpeg|png)(\?.*)$/i, '')
}

function toIiifInfoJsonUrl (imageOrBaseUrl) {
  const base = toIiifBaseUrl(imageOrBaseUrl)
  return base.endsWith('/info.json') ? base : `${base}/info.json`
}

/**
 * @param {string} svgText
 * @returns {Document}
 */
function parseSvgDocument (svgText) {
  const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parseError = svgDoc.querySelector('parsererror')
  if (parseError) throw new Error(`SVG parse error: ${parseError.textContent}`)
  return svgDoc
}

/**
 * @param {string} svgUrl
 * @returns {Promise<string>}
 */
function loadSvgTextCached (svgUrl) {
  if (!STRUCTURED_SVG_TEXT_CACHE.has(svgUrl)) {
    STRUCTURED_SVG_TEXT_CACHE.set(
      svgUrl,
      fetch(svgUrl).then(async (res) => {
        if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText} — ${svgUrl}`)
        return res.text()
      })
    )
  }
  return STRUCTURED_SVG_TEXT_CACHE.get(svgUrl)
}

/**
 * @param {Document} svgDom
 * @returns {{
 *  iiifBaseUrl: string,
 *  image: { width: number, height: number, rotationDeg: number } | null,
 *  writingZoneGroup: SVGElement | null,
 *  pageMarginGroup: SVGElement | null
 * }}
 */
function computeMetadata (svgDom) {
  const svgRoot = svgDom.documentElement
  const sceneSvg = svgDom.querySelector('svg.definition-scale') || svgRoot
  const scene = parseViewBox(sceneSvg)

  const facsimileImageEl = svgDom.querySelector('image.facsimileImage')
  const bgUse = svgDom.querySelector('use#Hintergrund')
  const defsImageEl = svgDom.querySelector('image#facsimile')

  const useHref = getUseHref(bgUse)
  const referencedImageEl = useHref.startsWith('#')
    ? svgDom.getElementById(useHref.slice(1))
    : null

  const facsimileEl = facsimileImageEl || bgUse || defsImageEl
  const sourceImageEl = facsimileImageEl || referencedImageEl || defsImageEl

  const rawHref = getImageHref(sourceImageEl) || (useHref && !useHref.startsWith('#') ? useHref : '')
  const iiifBaseUrl = toIiifBaseUrl(rawHref)

  const width = getNumericAttr(facsimileEl, 'width', getNumericAttr(sourceImageEl, 'width', 0))
  const height = getNumericAttr(facsimileEl, 'height', getNumericAttr(sourceImageEl, 'height', 0))
  const x = getNumericAttr(facsimileEl, 'x', 0)
  const y = getNumericAttr(facsimileEl, 'y', 0)

  const imageTransform = facsimileEl ? `${facsimileEl.getAttribute('transform') || ''} ${facsimileEl.getAttribute('style') || ''}` : ''
  const backgroundTransform = bgUse ? `${bgUse.getAttribute('transform') || ''} ${bgUse.getAttribute('style') || ''}` : ''
  const rawRotationDeg = extractRotationDeg(imageTransform) || extractRotationDeg(backgroundTransform)
  // Keep existing sign convention: calculatePagePosition applies one inversion.
  const rotationDeg = rawRotationDeg * -1

  const shapesSvg = svgDom.querySelector('g.shapes > svg')
  const writingZone = svgDom.querySelector('g.writingZone')
  const pageMargin = svgDom.querySelector('g.page-margin')
  const writingZoneGroup = shapesSvg
    ? cloneShapesSvgForOverlay(shapesSvg)
    : (writingZone ? writingZone.cloneNode(true) : null)
  const pageMarginGroup = pageMargin
    ? wrapGroupWithAncestorTransforms(pageMargin, sceneSvg)
    : null
  const defs = collectDefsGroup(svgDom)

  return {
    iiifBaseUrl,
    image: width > 0 && height > 0 ? { x, y, width, height, rotationDeg } : null,
    scene,
    overlayFrame: null,
    writingZoneGroup,
    pageMarginGroup,
    defsGroup: defs
  }
}

/**
 * @param {Document} svgDom
 * @returns {{
 *  iiifBaseUrl: string,
 *  image: { width: number, height: number, rotationDeg: number },
 *  writingZoneGroup: SVGElement | null,
 *  pageMarginGroup: SVGElement | null,
 *  page: { image: string, px: { width: number, height: number }, mm: { width: number, height: number } }
 * }}
 */
function prepareDataForTranscriptions (svgDom) {
  const metadata = computeMetadata(svgDom)

  if (!metadata.iiifBaseUrl || !metadata.image) {
    throw new Error('Structured SVG does not include facsimile metadata')
  }

  const { x, y, width, height, rotationDeg } = metadata.image
  const placement = { x, y, width, height }
  return {
    ...metadata,
    page: {
      image: metadata.iiifBaseUrl,
      rotate: rotationDeg,
      px: { width, height },
      mm: {
        width: metadata.scene?.width || width,
        height: metadata.scene?.height || height
      },
      placement,
      scene: metadata.scene
    }
  }
}

class FluidAnimationController {
  constructor (svgElementOrElements) {
    this.svgElements = Array.isArray(svgElementOrElements)
      ? svgElementOrElements.filter(Boolean)
      : [svgElementOrElements].filter(Boolean)
    this.animations = []
  }

  init () {
    this.parseAnimations()
    this.disableAutoAnimation()
    this.setProgress(0)
  }

  parseAnimations () {
    this.animations = []

    this.svgElements.forEach((svgElement) => {
      const animateElements = svgElement.querySelectorAll('animate, animateTransform')

      animateElements.forEach((element) => {
        const valuesAttr = element.getAttribute('values')
        const attributeName = element.getAttribute('attributeName')
        const targetElement = element.parentElement

        if (!valuesAttr || !attributeName || !targetElement) return

        const values = valuesAttr.split(';').map(v => v.trim())
        const animationData = {
          element,
          targetElement,
          attributeName,
          values,
          type: element.tagName.toLowerCase()
        }

        if (animationData.type === 'animatetransform') {
          animationData.transformType = element.getAttribute('type') || 'translate'
        }

        this.animations.push(animationData)
      })
    })
  }

  disableAutoAnimation () {
    this.animations.forEach(({ element }) => {
      element.setAttribute('begin', 'indefinite')
      element.removeAttribute('repeatCount')
      if (typeof element.endElement === 'function') {
        try {
          element.endElement()
        } catch (_e) {}
      }
    })
  }

  setProgress (progress) {
    const clamped = Math.max(0, Math.min(1, progress))
    this.animations.forEach((animation) => {
      const interpolated = this.interpolateValue(animation, clamped)
      this.applyValue(animation, interpolated)
    })
  }

  interpolateValue (animation, progress) {
    const { values } = animation
    const segmentCount = values.length - 1
    if (segmentCount <= 0) return values[0] || ''

    const scaled = progress * segmentCount
    const segmentIndex = Math.min(Math.floor(scaled), segmentCount - 1)
    const segmentProgress = scaled - segmentIndex
    const startValue = values[segmentIndex]
    const endValue = values[segmentIndex + 1]

    return this.interpolateBetweenValues(startValue, endValue, segmentProgress, animation)
  }

  interpolateBetweenValues (startValue, endValue, t, animation) {
    const { attributeName } = animation

    if (attributeName === 'opacity') return this.interpolateNumbers(startValue, endValue, t)
    if (attributeName === 'transform' && animation.transformType === 'translate') {
      return this.interpolateTranslate(startValue, endValue, t)
    }
    if (attributeName === 'd') return this.interpolatePathData(startValue, endValue, t)
    if (attributeName === 'points') return this.interpolatePoints(startValue, endValue, t)

    return t < 0.5 ? startValue : endValue
  }

  interpolateNumbers (startValue, endValue, t) {
    const start = parseFloat(startValue) || 0
    const end = parseFloat(endValue) || 0
    return (start + (end - start) * t).toString()
  }

  interpolateTranslate (startValue, endValue, t) {
    const startParts = this.parseTranslateValues(startValue)
    const endParts = this.parseTranslateValues(endValue)
    const x = startParts.x + (endParts.x - startParts.x) * t
    const y = startParts.y + (endParts.y - startParts.y) * t
    return `${x} ${y}`
  }

  parseTranslateValues (value) {
    const parts = value.trim().split(/\s+/)
    return {
      x: parseFloat(parts[0]) || 0,
      y: parseFloat(parts[1]) || 0
    }
  }

  interpolatePathData (startPath, endPath, t) {
    const numberPattern = /-?[\d.]+/g
    const startNumbers = startPath.match(numberPattern) || []
    const endNumbers = endPath.match(numberPattern) || []
    if (startNumbers.length !== endNumbers.length) return t < 0.5 ? startPath : endPath

    let index = 0
    return startPath.replace(numberPattern, () => {
      const startNum = parseFloat(startNumbers[index]) || 0
      const endNum = parseFloat(endNumbers[index]) || 0
      index++
      const interpolated = startNum + (endNum - startNum) * t
      return Math.round(interpolated * 100) / 100
    })
  }

  interpolatePoints (startPoints, endPoints, t) {
    const startCoords = this.parsePointsString(startPoints)
    const endCoords = this.parsePointsString(endPoints)
    if (startCoords.length !== endCoords.length) return t < 0.5 ? startPoints : endPoints

    const interpolated = startCoords.map((startPt, i) => {
      const endPt = endCoords[i]
      const x = startPt.x + (endPt.x - startPt.x) * t
      const y = startPt.y + (endPt.y - startPt.y) * t
      return `${Math.round(x)},${Math.round(y)}`
    })

    return interpolated.join(' ')
  }

  parsePointsString (pointsStr) {
    const points = []
    const pairs = pointsStr.trim().split(/\s+/)
    for (const pair of pairs) {
      const [xStr, yStr] = pair.split(',')
      points.push({ x: parseFloat(xStr) || 0, y: parseFloat(yStr) || 0 })
    }
    return points
  }

  applyValue (animation, value) {
    const { targetElement, attributeName, transformType } = animation
    if (attributeName === 'transform' && transformType) {
      targetElement.setAttribute('transform', `${transformType}(${value})`)
    } else if (attributeName === 'd') {
      targetElement.setAttribute('d', value)
    } else {
      targetElement.setAttribute(attributeName, value)
    }
  }
}

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

/**
 * Parse rendered SVG files with embedded facsimile + overlay groups.
 * @param {string} svgText
 * @returns {{
 *  iiifBaseUrl: string,
 *  image: { width: number, height: number, rotationDeg: number } | null,
 *  writingZoneGroup: SVGElement | null,
 *  pageMarginGroup: SVGElement | null
 * }}
 */
function preprocessSvgStructure (svgText) {
  const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parseError = svgDoc.querySelector('parsererror')
  if (parseError) throw new Error(`SVG parse error: ${parseError.textContent}`)

  const imageEl = svgDoc.querySelector('image#facsimile')
  const rawHref = imageEl
    ? (imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || imageEl.getAttribute('href') || '')
    : ''

  const iiifBaseUrl = rawHref.replace(/\/full\/full\/0\/default\.jpg$/i, '')
  const width = imageEl ? (parseFloat(imageEl.getAttribute('width')) || 0) : 0
  const height = imageEl ? (parseFloat(imageEl.getAttribute('height')) || 0) : 0

  const bgUse = svgDoc.querySelector('use#Hintergrund')
  const styleTransform = bgUse ? (bgUse.getAttribute('style') || '') : ''
  const rotationMatch = styleTransform.match(/rotate\(([-\d.]+)deg\)/)
  const rotationDeg = rotationMatch ? (parseFloat(rotationMatch[1]) || 0) : 0

  const writingZone = svgDoc.querySelector('g.writingZone')
  const pageMargin = svgDoc.querySelector('g.page-margin')

  return {
    iiifBaseUrl,
    image: width > 0 && height > 0 ? { width, height, rotationDeg } : null,
    writingZoneGroup: writingZone ? writingZone.cloneNode(true) : null,
    pageMarginGroup: pageMargin ? pageMargin.cloneNode(true) : null
  }
}

export class VideTranscrPanels extends HTMLElement {
  constructor () {
    super()
    /** @type {OpenSeadragon.Viewer[]} */
    this.viewers = []
    // Resolves once OSD viewers have been created
    this._readyResolve = null
    this._ready = new Promise(resolve => { this._readyResolve = resolve })
    this._panelStepValues = [2, 3, 8]
    this._panelAnimations = [null, null, null]
    this._baseImageItems = [null, null, null]
    this._shapesSvgEls = [null, null, null]
    this._dtSvgEls = [null, null, null]
    this._ftOverlayEls = [null, null, null]
    this._activeSliderAnimations = [null, null, null]
    this._sliderPointerDown = [false, false, false]
    // Cross-panel highlighting
    this._shapeLinks = null // { dtId: [shapeId] } from API
    this._atLinks = null // { atId: dtId }     from API (dtLinks in JSON)
    this._shapesSvgEl = null // legacy alias (panel 0)
    this._dtSvgEl = null // legacy alias (panel 1)
    this._atSvgEl = null // live <svg> from loadSvg
    this._bootstrapPromise = null
    this._bootstrapSourceUrl = null
    this._viewerSyncBound = false
  }

  connectedCallback () {
    requestAnimationFrame(() => {
      this._ensureMountedViewersReady().then(() => {
        this._ensureViewerSync()
      }).catch(err => {
        console.error('[VideTranscrPanels] init failed', err)
      })
    })
  }

  disconnectedCallback () {
    this.viewers.forEach(v => v.destroy())
    this.viewers = []
    // Reset the ready promise in case the element is re-connected
    this._ready = new Promise(resolve => { this._readyResolve = resolve })
    this._shapeLinks = null
    this._atLinks = null
    this._panelStepValues = [2, 3, 8]
    this._panelAnimations = [null, null, null]
    this._baseImageItems = [null, null, null]
    this._shapesSvgEls = [null, null, null]
    this._dtSvgEls = [null, null, null]
    this._ftOverlayEls = [null, null, null]
    this._activeSliderAnimations = [null, null, null]
    this._sliderPointerDown = [false, false, false]
    this._shapesSvgEl = null
    this._dtSvgEl = null
    this._atSvgEl = null
    this._bootstrapPromise = null
    this._bootstrapSourceUrl = null
    this._viewerSyncBound = false
  }

  async _ensureMountedViewersReady () {
    if (!this.querySelector('#transcr-panel-0')) this.render()
    if (!this.viewers.length) this._initViewers()
    await this._ready
  }

  /**
   * Single entrypoint for the temporary single-SVG transcription flow.
   * This inserts the HTML, initializes OSD, loads structured SVG data (cached),
   * prepares metadata, and initializes all three viewers.
   *
   * @returns {Promise<void>}
   */
  bootstrapFromCachedSampleSvg () {
    return this.bootstrapFromFtUri(SINGLE_TRANSCRIPTION_SVG_URL)
  }

  /**
   * Bootstrap transcription panels from a structured FT SVG URI.
   * @param {string} svgUrl
   * @returns {Promise<boolean>}
   */
  bootstrapFromFtUri (svgUrl) {
    if (!svgUrl) return Promise.resolve(false)

    if (this._bootstrapPromise && this._bootstrapSourceUrl === svgUrl) {
      return this._bootstrapPromise
    }

    this._bootstrapSourceUrl = svgUrl
    this._bootstrapPromise = this._runSingleSvgBootstrap(svgUrl)
    return this._bootstrapPromise
  }

  /**
   * Bootstrap transcription panels from structured FT SVG markup.
   * @param {string} svgText
   * @returns {Promise<boolean>}
   */
  bootstrapFromSvgText (svgText) {
    if (!svgText) return Promise.resolve(false)

    this._bootstrapSourceUrl = null
    this._bootstrapPromise = this._runSingleSvgBootstrapText(svgText)
    return this._bootstrapPromise
  }

  async _runSingleSvgBootstrap (svgUrl) {
    const svgText = await loadSvgTextCached(svgUrl)
    return this._runSingleSvgBootstrapText(svgText)
  }

  async _runSingleSvgBootstrapText (svgText) {
    await this._ensureMountedViewersReady()
    this._ensureViewerSync()

    const svgDom = parseSvgDocument(svgText)
    const metadata = prepareDataForTranscriptions(svgDom)

    console.log('Prepared metadata for transcription panels:', metadata)

    for (let viewerIndex = 0; viewerIndex < 3; viewerIndex++) {
      await this.initiateOSD(viewerIndex, metadata)
    }

    this.loadOverlayLayers(metadata)
    return true
  }

  _ensureViewerSync () {
    if (this._viewerSyncBound) return
    this._linkViewers(0, 1)
    this._linkViewers(0, 2)
    this._linkViewers(1, 2)
    this._viewerSyncBound = true
  }

  /**
   * Initialize one OSD panel from prepared metadata.
   * @param {number} viewerIndex
   * @param {{ page: { image: string, px: { width: number, height: number }, mm: { width: number, height: number } } }} metadata
   * @returns {Promise<void>}
   */
  async initiateOSD (viewerIndex, metadata) {
    this._resetPanelContent(viewerIndex)
    await this.loadPageImage(viewerIndex, metadata.page, { opacity: 1 })
  }

  /**
   * Placeholder for overlay loading in the new single-SVG pipeline.
   * @param {Object} metadata
   */
  loadOverlayLayers (metadata) {
    const OSD = window.OpenSeadragon
    const scene = metadata.page?.scene || { x: 0, y: 0, width: metadata.page.mm.width, height: metadata.page.mm.height }
    const pagePosition = this.calculatePagePosition(metadata.page)
    const shapesWidth = metadata.page?.px?.width || metadata.image?.width || scene.width
    const shapesHeight = metadata.page?.px?.height || metadata.image?.height || scene.height

    const buildOverlaySvg = (group, cssClass, { viewBox, location }) => {
      if (!group) return null

      const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svgContainer.setAttribute('width', '100%')
      svgContainer.setAttribute('height', '100%')
      svgContainer.setAttribute('viewBox', viewBox)
      svgContainer.style.cssText = 'display:block;overflow:visible'
      svgContainer.classList.add(cssClass)
      if (metadata.defsGroup) svgContainer.appendChild(metadata.defsGroup.cloneNode(true))
      svgContainer.appendChild(group.cloneNode(true))

      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'width:100%;height:100%;overflow:visible'
      wrapper.appendChild(svgContainer)

      return { svgContainer, wrapper, location }
    }

    for (const [index, viewer] of this.viewers.entries()) {
      const animationRoots = []

      const shapesOverlay = buildOverlaySvg(metadata.writingZoneGroup, 'shapes', {
        viewBox: `0 0 ${shapesWidth} ${shapesHeight}`,
        location: new OSD.Rect(pagePosition.x, pagePosition.y, pagePosition.width, pagePosition.height)
      })
      if (shapesOverlay) {
        viewer.addOverlay({
          element: shapesOverlay.wrapper,
          location: shapesOverlay.location
        })

        this._shapesSvgEls[index] = shapesOverlay.svgContainer
        if (index === 0) this._shapesSvgEl = shapesOverlay.svgContainer
        animationRoots.push(shapesOverlay.svgContainer)
      } else {
        this._shapesSvgEls[index] = null
      }

      const transcriptionsOverlay = buildOverlaySvg(metadata.pageMarginGroup, 'transcriptions', {
        viewBox: `${scene.x} ${scene.y} ${scene.width} ${scene.height}`,
        location: new OSD.Rect(scene.x, scene.y, scene.width, scene.height)
      })
      if (transcriptionsOverlay) {
        viewer.addOverlay({
          element: transcriptionsOverlay.wrapper,
          location: transcriptionsOverlay.location
        })

        this._ftOverlayEls[index] = transcriptionsOverlay.wrapper
        this._dtSvgEls[index] = transcriptionsOverlay.svgContainer
        if (index === 1) this._dtSvgEl = transcriptionsOverlay.svgContainer
        animationRoots.push(transcriptionsOverlay.svgContainer)
      } else {
        this._ftOverlayEls[index] = null
        this._dtSvgEls[index] = null
      }

      if (animationRoots.length) {
        const controller = new FluidAnimationController(animationRoots)
        controller.init()
        this._panelAnimations[index] = controller
      } else {
        this._panelAnimations[index] = null
      }

      this._applyStepValue(index, this._panelStepValues[index], { commit: false, syncUi: true })
    }

    this._tryInitHighlighting()
  }

  render () {
    this.innerHTML = `
      <div class="transcr-panels-container">
        ${[0, 1, 2].map(i => `
          <div class="transcr-panel-wrapper">
            <h3 class="transcr-panel-label">
              <div class="transcr-panel-label-left">
                <span class="transcr-panel-title">${PANEL_LABELS[i]}</span>
                <span class="transcr-step-title" data-step-title="${i}">${STEP_LABELS[this._panelStepValues[i] - 1]}</span>
              </div>
              <div class="transcr-step-controls">
                <button type="button" class="transcr-step-btn" data-step-prev="${i}" aria-label="Vorherige Stufe">&lt;</button>
                <input
                  class="transcr-step-slider"
                  data-step-slider="${i}"
                  type="range"
                  min="1"
                  max="8"
                  step="0.01"
                  value="${this._panelStepValues[i]}"
                  list="transcr-steps-${i}"
                  aria-label="Stufe wählen"
                >
                <datalist id="transcr-steps-${i}">
                  ${[1, 2, 3, 4, 5, 6, 7, 8].map(s => `<option value="${s}"></option>`).join('')}
                </datalist>
                <button type="button" class="transcr-step-btn" data-step-next="${i}" aria-label="Nächste Stufe">&gt;</button>
              </div>
            </h3>
            <div class="transcr-panel phase${this._snapStep(this._panelStepValues[i])}" id="transcr-panel-${i}"></div>
          </div>
        `).join('')}
      </div>
    `

    this._bindStepControls()
  }

  _bindStepControls () {
    for (let i = 0; i < 3; i++) {
      const slider = this.querySelector(`[data-step-slider="${i}"]`)
      const prevBtn = this.querySelector(`[data-step-prev="${i}"]`)
      const nextBtn = this.querySelector(`[data-step-next="${i}"]`)
      if (!slider || !prevBtn || !nextBtn) continue

      slider.addEventListener('pointerdown', () => {
        this._sliderPointerDown[i] = true
      })

      const finishPointerDrag = () => {
        if (!this._sliderPointerDown[i]) return
        this._sliderPointerDown[i] = false
        this._setPanelStep(i, parseFloat(slider.value))
      }

      slider.addEventListener('pointerup', finishPointerDrag)
      slider.addEventListener('pointercancel', finishPointerDrag)

      slider.addEventListener('input', () => {
        const value = parseFloat(slider.value)
        this._applyStepValue(i, value, { commit: false, syncUi: true })
      })

      slider.addEventListener('change', () => {
        if (this._sliderPointerDown[i]) return
        this._setPanelStep(i, parseFloat(slider.value))
      })

      prevBtn.addEventListener('click', () => this._stepByButton(i, -1))
      nextBtn.addEventListener('click', () => this._stepByButton(i, 1))
    }
  }

  _snapStep (value) {
    const rounded = Math.round(value)
    return Math.max(1, Math.min(8, rounded))
  }

  _isStepSnappingEnabled () {
    const rawValue = this.getAttribute(STEP_SNAPPING_ATTRIBUTE)
    if (rawValue == null) return true

    const mode = rawValue.trim().toLowerCase()
    return mode !== 'off' && mode !== 'false' && mode !== '0' && mode !== 'none'
  }

  _normalizeCommittedStep (value) {
    const clamped = Math.max(1, Math.min(8, value))
    return this._isStepSnappingEnabled() ? this._snapStep(clamped) : clamped
  }

  _stepByButton (panelIndex, delta) {
    const current = this._snapStep(this._panelStepValues[panelIndex])
    const target = Math.max(1, Math.min(8, current + delta))
    if (target === current) return
    this._animatePanelStep(panelIndex, target)
  }

  _animatePanelStep (panelIndex, targetStep) {
    const startStep = this._panelStepValues[panelIndex]
    const totalSteps = Math.abs(targetStep - startStep)
    if (totalSteps === 0) return

    if (this._activeSliderAnimations[panelIndex]) {
      cancelAnimationFrame(this._activeSliderAnimations[panelIndex])
      this._activeSliderAnimations[panelIndex] = null
    }

    const slider = this.querySelector(`[data-step-slider="${panelIndex}"]`)
    const startTime = performance.now()
    const duration = totalSteps * 2000

    const tick = (now) => {
      const elapsed = Math.max(0, now - startTime)
      const t = Math.min(1, elapsed / duration)
      const current = startStep + (targetStep - startStep) * t
      this._applyStepValue(panelIndex, current, { commit: false, syncUi: false })
      if (slider) slider.value = String(current)

      if (t < 1) {
        this._activeSliderAnimations[panelIndex] = requestAnimationFrame(tick)
      } else {
        this._activeSliderAnimations[panelIndex] = null
        this._setPanelStep(panelIndex, targetStep)
      }
    }

    this._activeSliderAnimations[panelIndex] = requestAnimationFrame(tick)
  }

  _setPanelStep (panelIndex, step) {
    const committed = this._normalizeCommittedStep(step)
    this._panelStepValues[panelIndex] = committed
    this._applyStepValue(panelIndex, committed, { commit: true, syncUi: true })
  }

  _updateStepUi (panelIndex, value, snappedStep) {
    const slider = this.querySelector(`[data-step-slider="${panelIndex}"]`)
    if (slider) slider.value = String(value)

    const committedStep = this._panelStepValues[panelIndex]
    const committedStage = this._snapStep(committedStep)
    const activeStep = Number.isInteger(snappedStep) ? snappedStep : committedStage

    const title = this.querySelector(`[data-step-title="${panelIndex}"]`)
    if (title) title.textContent = STEP_LABELS[activeStep - 1]

    const prevBtn = this.querySelector(`[data-step-prev="${panelIndex}"]`)
    const nextBtn = this.querySelector(`[data-step-next="${panelIndex}"]`)
    if (prevBtn) prevBtn.disabled = activeStep <= 1
    if (nextBtn) nextBtn.disabled = activeStep >= 8
  }

  _applyStepValue (panelIndex, rawStep, { commit = false, syncUi = true } = {}) {
    const step = Math.max(1, Math.min(8, rawStep))
    const committed = this._normalizeCommittedStep(step)
    if (commit) this._panelStepValues[panelIndex] = committed

    const panel = this.querySelector(`#transcr-panel-${panelIndex}`)
    if (panel) {
      panel.classList.remove(...PHASE_CLASSES)
      panel.classList.add(`phase${this._snapStep(step)}`)
    }

    // Facsimile: full visible at steps 1-2, 50% at 3, then fade to 0 by 4.
    let imageOpacity = 0
    if (step <= 2) {
      imageOpacity = 1
    } else if (step <= 3) {
      imageOpacity = 1 - 0.5 * (step - 2)
    } else if (step <= 4) {
      imageOpacity = 0.5 * (4 - step)
    }

    // Shapes: hidden at 1, visible at 2, then fade out by 3.
    let shapesOpacity = 0
    if (step <= 1) {
      shapesOpacity = 0
    } else if (step <= 2) {
      shapesOpacity = step - 1
    } else if (step <= 3) {
      shapesOpacity = 3 - step
    }

    // FT appears from 2->3.
    let ftOpacity = 0
    if (step > 2 && step < 3) {
      ftOpacity = step - 2
    } else if (step >= 3) {
      ftOpacity = 1
    }

    // UI stages are 1-based while animation keyframes start at progress 0.
    // Map stage 1 -> 0/7 and stage 8 -> 7/7 so keyed values line up exactly.
    const animationProgress = (step - 1) / 7

    const imageItem = this._baseImageItems[panelIndex]
    if (imageItem) imageItem.setOpacity(Math.max(0, Math.min(1, imageOpacity)))

    const shapesEl = this._shapesSvgEls[panelIndex]
    if (shapesEl) {
      shapesEl.style.opacity = String(Math.max(0, Math.min(1, shapesOpacity)))
      shapesEl.style.pointerEvents = 'auto'
    }

    const ftWrapper = this._ftOverlayEls[panelIndex]
    if (ftWrapper) {
      ftWrapper.style.opacity = String(Math.max(0, Math.min(1, ftOpacity)))
      ftWrapper.style.pointerEvents = step >= 3 ? 'auto' : 'none'
    }

    const controller = this._panelAnimations[panelIndex]
    if (controller) controller.setProgress(Math.max(0, Math.min(1, animationProgress)))

    if (syncUi) this._updateStepUi(panelIndex, step, commit ? this._snapStep(committed) : null)
  }

  /**
   * @param {{ defaultSteps?: number[], snapOnCommit?: boolean }} [options]
   * defaultSteps: initial stage values per panel.
   * snapOnCommit: enable/disable commit snapping (true = integer stages).
   */
  configurePanels ({ defaultSteps = [2, 3, 8], snapOnCommit } = {}) {
    if (typeof snapOnCommit === 'boolean') {
      this.setAttribute(STEP_SNAPPING_ATTRIBUTE, snapOnCommit ? 'on' : 'off')
    }

    defaultSteps.forEach((step, i) => {
      if (typeof step === 'number') this._panelStepValues[i] = this._normalizeCommittedStep(step)
      this._updateStepUi(i, this._panelStepValues[i], this._panelStepValues[i])
      this._applyStepValue(i, this._panelStepValues[i], { commit: true, syncUi: true })
    })
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
    this.configurePanels({ defaultSteps: this._panelStepValues })

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

  // Legacy overlay loading API (kept for compatibility). The new single-SVG
  // bootstrap flow uses bootstrapFromCachedSampleSvg + initiateOSD instead.

  /**
   * Fetch the renderedWz SVG and add it as a live-DOM OSD overlay on the given
   * panel, positioned to cover exactly the page's mm extent (0,0 → mm.width, mm.height).
   *
   * The SVG is wrapped in a <div> that OSD owns and resizes. Inside that div the
   * SVG is set to width/height 100% so CSS scales it to always fill the container,
   * while its original viewBox is preserved — so internal shape coordinates remain
   * correct at every zoom level.
   *
   * @param {number} panelIndex
   * @param {string} svgUrl
   * @param {{ width:number, height:number }} mm  page mm dimensions
   */
  async loadRenderedWzOverlay (panelIndex, svgUrl, mm) {
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
    svgEl.style.cssText = 'display:block'
    svgEl.classList.add('renderedWz')

    // OSD manages this wrapper div: it sets its CSS position/size to match the
    // world-space rect at every viewport change. The SVG inside scales with it.
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden'
    wrapper.appendChild(svgEl)

    const OSD = window.OpenSeadragon

    viewer.addOverlay({
      element: wrapper,
      location: new OSD.Rect(0, 0, mm.width, mm.height),
      checkResize: false
    })

    this._dtSvgEls[panelIndex] = svgEl
    if (panelIndex === 1) this._dtSvgEl = svgEl
    this._tryInitHighlighting()
  }

  /**
   * Load FT SVG as a live OSD overlay.
   * Optional rotation uses mm-based pivot coordinates in page space.
   *
   * @param {number} panelIndex
   * @param {string} svgUrl
   * @param {{ width:number, height:number }} mm
   * @param {{ rotation?: { angle?: number, pivot?: { x?: number, y?: number }, invertDirection?: boolean } }} [options]
   */
  async loadFtOverlay (panelIndex, svgUrl, mm, { rotation = null } = {}) {
    if (!svgUrl) return

    await this._ready
    const viewer = this.viewers[panelIndex]
    if (!viewer) return

    const res = await fetch(svgUrl)
    if (!res.ok) throw new Error(`ft SVG fetch failed: ${res.status} ${res.statusText} — ${svgUrl}`)
    const svgText = await res.text()

    const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const parseError = svgDoc.querySelector('parsererror')
    if (parseError) throw new Error(`ft SVG parse error: ${parseError.textContent}`)

    const svgEl = svgDoc.documentElement
    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    svgEl.style.cssText = 'display:block'
    svgEl.classList.add('renderedWz', 'ftTranscription')

    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;opacity:0;pointer-events:none'

    const rotateWrapper = document.createElement('div')
    rotateWrapper.style.width = '100%'
    rotateWrapper.style.height = '100%'
    rotateWrapper.classList.add('ftRotateWrapper')

    if (rotation && Number.isFinite(rotation.angle)) {
      const signedAngle = rotation.invertDirection ? -rotation.angle : rotation.angle
      const pivotX = Number(rotation?.pivot?.x)
      const pivotY = Number(rotation?.pivot?.y)
      const originX = Number.isFinite(pivotX) && mm?.width
        ? (pivotX / mm.width) * 100
        : 50
      const originY = Number.isFinite(pivotY) && mm?.height
        ? (pivotY / mm.height) * 100
        : 50

      rotateWrapper.style.transformOrigin = `${originX}% ${originY}%`
      rotateWrapper.style.transform = `rotate(${signedAngle}deg)`
    }

    rotateWrapper.appendChild(svgEl)
    wrapper.appendChild(rotateWrapper)

    const OSD = window.OpenSeadragon
    viewer.addOverlay({
      element: wrapper,
      location: new OSD.Rect(0, 0, mm.width, mm.height),
      checkResize: false
    })

    const controller = new FluidAnimationController(svgEl)
    controller.init()
    this._panelAnimations[panelIndex] = controller
    this._ftOverlayEls[panelIndex] = wrapper
    this._dtSvgEls[panelIndex] = svgEl
    if (panelIndex === 1) this._dtSvgEl = svgEl
    this._applyStepValue(panelIndex, this._panelStepValues[panelIndex], { commit: false, syncUi: true })
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
    const hasShapes = this._shapesSvgEls.some(Boolean)
    const hasDt = this._dtSvgEls.some(Boolean)
    if (this._shapeLinks && hasShapes && hasDt) {
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
    const shapesSvgs = this._shapesSvgEls.filter(Boolean)
    const dtSvgs = this._dtSvgEls.filter(Boolean)
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
      dtSvgs.forEach(dtSvg => {
        dtSvg.querySelectorAll(`[data-id="${dtId}"]`).forEach(el => entry.dtEls.add(el))
      })
      for (const sid of shapeIds) {
        shapesSvgs.forEach(shapesSvg => {
          const el = shapesSvg.getElementById(sid)
          if (el) entry.shapeEls.add(el)
        })
      }
    }

    // Populate AT elements linked via atLinks (JSON): atId → dtId | [dtId, ...]
    if (atLinks && atSvg) {
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
      if (el.dataset.transcrHighlightBound === '1') continue
      el.dataset.transcrHighlightBound = '1'
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
    // console.log('Calculating page position for', page)

    const parsed = parseImageUrl(page.image || '')
    const target = (parsed.target || page.image || '').split('?')[0] // strip query params for tile source URL

    const tileSource = toIiifInfoJsonUrl(target)
    const degrees = (Number.isFinite(page.rotate) ? page.rotate : (Number.isFinite(parsed.rotation) ? parsed.rotation : 0)) * -1

    if (page.placement) {
      const placement = page.placement
      const mmPerPx = page.px?.width > 0
        ? placement.width / page.px.width
        : 1
      const height = Number.isFinite(placement.height) && placement.height > 0
        ? placement.height
        : (page.px?.height || 0) * mmPerPx

      return {
        tileSource,
        x: placement.x || 0,
        y: placement.y || 0,
        width: placement.width,
        height,
        degrees,
        mmPerPx
      }
    }

    const crop = parsed.xywh || { x: 0, y: 0, w: 0, h: 0 }
    const hasCrop = crop.w > 0 && crop.h > 0
    const pageWidthPx = hasCrop ? crop.w : (page.px?.width || 0)
    const pageHeightPx = hasCrop ? crop.h : (page.px?.height || 0)

    const mmPerPxFromWidth = pageWidthPx > 0 ? (page.mm?.width || 0) / pageWidthPx : 0
    const mmPerPxFromHeight = pageHeightPx > 0 ? (page.mm?.height || 0) / pageHeightPx : 0
    const mmPerPx = mmPerPxFromWidth || mmPerPxFromHeight || 1

    const fullImageWidthMm = (page.px?.width || pageWidthPx) * mmPerPx
    const fullImageHeightMm = (page.px?.height || pageHeightPx) * mmPerPx

    const offsetX = hasCrop ? ((page.mm?.width || 0) - crop.w * mmPerPx) / 2 : 0
    const offsetY = hasCrop ? ((page.mm?.height || 0) - crop.h * mmPerPx) / 2 : 0
    const x = hasCrop ? (-crop.x * mmPerPx + offsetX) : 0
    const y = hasCrop ? (-crop.y * mmPerPx + offsetY) : 0

    return {
      tileSource,
      x,
      y,
      width: fullImageWidthMm,
      height: fullImageHeightMm,
      degrees,
      mmPerPx
    }
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
    svgEl.style.display = 'block'
    svgEl.style.overflow = 'visible'
    svgEl.classList.add('pageShapes')

    // Keep the SVG coordinate system stable; apply page-specific correction on
    // the overlay container so shape IDs and geometry remain unchanged.
    const overlayEl = document.createElement('div')
    overlayEl.style.width = '100%'
    overlayEl.style.height = '100%'
    overlayEl.style.overflow = 'visible'

    const rotateElem = document.createElement('div')
    rotateElem.style.width = '100%'
    rotateElem.style.height = '100%'
    rotateElem.classList.add('rotateWrapper')
    const parsed = parseImageUrl(page.image || '')
    const rotation = Number.isFinite(parsed.rotation)
      ? -parsed.rotation
      : -(page?.px?.rotation || 0)
    rotateElem.style.transform = 'rotate(' + rotation + 'deg)'
    rotateElem.style.transformOrigin = 'center center'
    rotateElem.appendChild(svgEl)
    overlayEl.appendChild(rotateElem)

    if (page.shapesGroupId) {
      const groupEl = svgEl.getElementById(page.shapesGroupId)
      if (groupEl) groupEl.classList.add('active')
    }

    // World-space rect that matches the tiled image placement exactly.
    // pos.width = fullImageWidthMm; derive height from the same mmPerPx factor.
    const pos = this.calculatePagePosition(page)
    const fullImageHeightMm = pxHeight * pos.mmPerPx
    const OSD = window.OpenSeadragon

    viewer.addOverlay({
      element: overlayEl,
      location: new OSD.Rect(pos.x, pos.y, pos.width, fullImageHeightMm, 0),
      checkResize: false
    })

    this._shapesSvgEls[panelIndex] = svgEl
    if (panelIndex === 0) this._shapesSvgEl = svgEl
    this._applyStepValue(panelIndex, this._panelStepValues[panelIndex], { commit: false, syncUi: true })
    this._tryInitHighlighting()
  }

  _resetPanelContent (panelIndex) {
    const viewer = this.viewers[panelIndex]
    if (!viewer) return
    viewer.clearOverlays()
    viewer.world.removeAll()
    this._baseImageItems[panelIndex] = null
    this._shapesSvgEls[panelIndex] = null
    this._dtSvgEls[panelIndex] = null
    this._ftOverlayEls[panelIndex] = null
    this._panelAnimations[panelIndex] = null
  }

  _addStructuredGroupOverlay (panelIndex, page, groupEl, className) {
    if (!groupEl) return null
    const viewer = this.viewers[panelIndex]
    if (!viewer) return null

    const svgNs = 'http://www.w3.org/2000/svg'
    const { width: pxWidth, height: pxHeight } = page.px

    const svgEl = document.createElementNS(svgNs, 'svg')
    svgEl.setAttribute('viewBox', `0 0 ${pxWidth} ${pxHeight}`)
    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    svgEl.style.display = 'block'
    svgEl.style.overflow = 'visible'
    svgEl.classList.add(className)
    svgEl.appendChild(groupEl.cloneNode(true))

    const overlayEl = document.createElement('div')
    overlayEl.style.width = '100%'
    overlayEl.style.height = '100%'
    overlayEl.style.overflow = 'visible'

    const rotateElem = document.createElement('div')
    rotateElem.style.width = '100%'
    rotateElem.style.height = '100%'
    rotateElem.classList.add('rotateWrapper')
    const parsed = parseImageUrl(page.image || '')
    const rotation = Number.isFinite(parsed.rotation) ? -parsed.rotation : 0
    rotateElem.style.transform = 'rotate(' + rotation + 'deg)'
    rotateElem.style.transformOrigin = 'center center'
    rotateElem.appendChild(svgEl)
    overlayEl.appendChild(rotateElem)

    const pos = this.calculatePagePosition(page)
    const fullImageHeightMm = pxHeight * pos.mmPerPx
    const OSD = window.OpenSeadragon
    viewer.addOverlay({
      element: overlayEl,
      location: new OSD.Rect(pos.x, pos.y, pos.width, fullImageHeightMm, 0),
      checkResize: false
    })

    return { svgEl, wrapperEl: overlayEl }
  }

  /**
   * Load a structured rendered SVG into all three OSD panels.
   * Uses the embedded facsimile IIIF link as base image and adds the
   * writingZone/page-margin groups as DOM SVG overlays.
   *
   * @param {string} svgUrl
   * @returns {Promise<boolean>} true when structured load was applied
   */
  async loadStructuredSvgAcrossPanels (svgUrl) {
    if (!svgUrl) return false
    await this._ready

    const res = await fetch(svgUrl)
    if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText} — ${svgUrl}`)
    const svgText = await res.text()
    const pre = preprocessSvgStructure(svgText)
    if (!pre.iiifBaseUrl || !pre.image) return false

    const { width, height, rotationDeg } = pre.image
    const page = {
      image: `${pre.iiifBaseUrl}#xywh=0,0,${width},${height}&rotate=${rotationDeg}`,
      px: { width, height },
      mm: { width, height }
    }

    for (let i = 0; i < 3; i++) {
      this._resetPanelContent(i)
      await this.loadPageImage(i, page, { opacity: 1 })

      const animationRoots = []

      const writingOverlay = this._addStructuredGroupOverlay(i, page, pre.writingZoneGroup, 'pageShapes')
      if (writingOverlay?.svgEl) {
        this._shapesSvgEls[i] = writingOverlay.svgEl
        if (i === 0) this._shapesSvgEl = writingOverlay.svgEl
        animationRoots.push(writingOverlay.svgEl)
      }

      const marginOverlay = this._addStructuredGroupOverlay(i, page, pre.pageMarginGroup, 'renderedWz')
      if (marginOverlay?.wrapperEl) {
        this._ftOverlayEls[i] = marginOverlay.wrapperEl
        this._dtSvgEls[i] = marginOverlay.svgEl
        if (i === 1) this._dtSvgEl = marginOverlay.svgEl
        animationRoots.push(marginOverlay.svgEl)
      }

      if (animationRoots.length) {
        const controller = new FluidAnimationController(animationRoots)
        controller.init()
        this._panelAnimations[i] = controller
      }
    }

    this._applyStepValue(0, this._panelStepValues[0], { commit: false, syncUi: true })
    this._applyStepValue(1, this._panelStepValues[1], { commit: false, syncUi: true })
    this._applyStepValue(2, this._panelStepValues[2], { commit: false, syncUi: true })
    this._tryInitHighlighting()
    return true
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

    console.log('got pos: ', pos)

    return new Promise((resolve, reject) => {
      viewer.addTiledImage({
        tileSource,
        x,
        y,
        width,
        degrees,
        success: ({ item }) => {
          this._baseImageItems[panelIndex] = item
          if (opacity !== 1) item.setOpacity(opacity)
          const scene = page.scene || {
            x: page.placement?.x || 0,
            y: page.placement?.y || 0,
            width: page.placement?.width || page.mm.width,
            height: page.placement?.height || page.mm.height
          }
          const bounds = rect
            ? this.calculateRectBounds(rect, pos)
            : new OSD.Rect(scene.x, scene.y, scene.width, scene.height)
          viewer.viewport.fitBounds(bounds, true)
          resolve()
        },
        error: ({ message }) => {
          reject(new Error(`Page image load failed: ${message || tileSource}`))
        }
      })
    })
  }
}
