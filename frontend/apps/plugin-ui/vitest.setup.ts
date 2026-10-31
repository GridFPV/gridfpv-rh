// jest-dom matchers (toBeInTheDocument, …); @testing-library/svelte/vite auto-cleans the DOM.
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement the native <dialog> modal API; drive the reflected `open`
// attribute the way a real <dialog> would so the Dialog primitive renders under test.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

// jsdom has no ResizeObserver; Svelte's `bind:clientHeight` (OverlayPanel measures its head,
// #96) needs one. Sizes are 0 under jsdom either way; the stub only keeps the binding quiet.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
