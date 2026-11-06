import '@testing-library/jest-dom/vitest';
import { notifications } from '@mantine/notifications';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// findBy*/waitFor give up after 1 s by default: too short for a grid rendered while other test files hog the CPU.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The notification store is a global: toasts that stay open (failures) would otherwise pile up across tests until
  // Mantine's limit hides the next one.
  notifications.clean();
});

// jsdom has no layout engine. Mantine and the data grid expect these browser APIs to exist.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
window.HTMLElement.prototype.scrollTo ??= () => undefined;

// The table virtualizes rows from the scroll area's size, which is 0x0 without layout: give elements a real-looking size,
// so rows are rendered like in a browser.
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 });
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1200 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) };
};

// Object URLs are not implemented in jsdom.
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => undefined;

// Blob.text() is missing from older jsdom versions.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
