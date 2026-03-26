import { describe, expect, it } from 'vitest'
import { VideTranscrPanels } from '../src/vide-transcr-panels.js'

const TEST_TAG = 'vide-transcr-panels-slider-test'

if (!customElements.get(TEST_TAG)) {
  customElements.define(TEST_TAG, VideTranscrPanels)
}

describe('panel slider interactions', () => {
  it('does not snap while dragging and only commits on release', () => {
    const panels = document.createElement(TEST_TAG)
    panels.render()

    const slider = panels.querySelector('[data-step-slider="0"]')
    const title = panels.querySelector('[data-step-title="0"]')

    expect(slider).toBeTruthy()
    expect(title).toBeTruthy()
    expect(panels._panelStepValues[0]).toBe(2)

    slider.dispatchEvent(new Event('pointerdown'))
    slider.value = '2.6'
    slider.dispatchEvent(new Event('input'))
    slider.dispatchEvent(new Event('change'))

    expect(slider.value).toBe('2.6')
    expect(panels._panelStepValues[0]).toBe(2)
    expect(title.textContent).toBe('Zeichendeutung')

    slider.dispatchEvent(new Event('pointerup'))

    expect(panels._panelStepValues[0]).toBe(3)
    expect(slider.value).toBe('3')
    expect(title.textContent).toBe('Zeichendeutung')
  })

  it('updates the step label live during slider input', () => {
    const panels = document.createElement(TEST_TAG)
    panels.render()

    const slider = panels.querySelector('[data-step-slider="0"]')
    const title = panels.querySelector('[data-step-title="0"]')

    expect(title.textContent).toBe('Schreibzonenerfassung')

    slider.value = '6.2'
    slider.dispatchEvent(new Event('input'))

    expect(panels._panelStepValues[0]).toBe(2)
    expect(title.textContent).toBe('Editorische Ergänzung')
    expect(slider.value).toBe('6.2')
  })
})
