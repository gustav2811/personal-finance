import { JSDOM } from "jsdom"
const measuredRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 800,
  bottom: 400,
  width: 800,
  height: 400,
  toJSON() {
    return {}
  },
}
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
})
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: measuredRect } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  },
})
Object.defineProperty(dom.window, "matchMedia", {
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
})
for (const key of Object.getOwnPropertyNames(dom.window).filter(
  (name) =>
    /^HTML.*Element$/.test(name) ||
    [
      "SVGElement",
      "DocumentFragment",
      "CustomEvent",
      "Event",
      "MouseEvent",
      "PointerEvent",
      "NodeFilter",
    ].includes(name),
)) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: (dom.window as unknown as Record<string, unknown>)[key],
  })
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
dom.window.HTMLElement.prototype.hasPointerCapture = () => false
dom.window.HTMLElement.prototype.setPointerCapture = () => {}
dom.window.HTMLElement.prototype.releasePointerCapture = () => {}

Object.defineProperty(
  dom.window.HTMLElement.prototype,
  "getBoundingClientRect",
  { configurable: true, value: () => measuredRect },
)
