import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import { tick } from 'svelte';
import DialogHarness from './DialogHarness.svelte';

// jsdom has no modal dialogs: emulate the element's open flag and its native `close` event,
// which is what the component reports `onclose` from.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function () {
    this.setAttribute('open', '');
  };
  proto.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('Dialog', () => {
  it('reports a close once from the × button, once from the backdrop, once from the parent', async () => {
    const onclose = vi.fn();
    const { container, rerender } = render(DialogHarness, { open: true, onclose });
    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    await fireEvent.click(container.querySelector('.gf-dialog-close') as HTMLButtonElement);
    await tick();
    expect(dialog.open).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(1);

    await rerender({ open: true, onclose });
    await tick();
    expect(dialog.open).toBe(true);
    // The backdrop is the dialog element itself, far from the panel (which has no size in jsdom).
    await fireEvent.click(dialog, { clientX: 2000, clientY: 2000 });
    await tick();
    expect(dialog.open).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(2);

    await rerender({ open: true, onclose });
    await tick();
    await rerender({ open: false, onclose });
    await tick();
    expect(dialog.open).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(3);
  });
});
