import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import RssiTrace from '../src/components/RssiTrace.svelte';

describe('RssiTrace', () => {
  it('draws the signal, both threshold lines, and one band per computed pass', () => {
    const trace = {
      times: [0, 1, 2, 3, 4, 5],
      values: [10, 90, 95, 20, 85, 10]
    };
    const { container } = render(RssiTrace, { trace, enter: 70, exit: 50 });
    expect(container.querySelector('path.rssi')).not.toBeNull();
    expect(container.querySelector('line.enter')).not.toBeNull();
    expect(container.querySelector('line.exit')).not.toBeNull();
    expect(container.querySelectorAll('rect.pass')).toHaveLength(2);
    expect(container.querySelectorAll('rect.handle')).toHaveLength(2);
  });

  it('has no drag handles when readonly', () => {
    const { container } = render(RssiTrace, {
      trace: { times: [0, 1], values: [1, 2] },
      enter: 70,
      exit: 50,
      readonly: true
    });
    expect(container.querySelectorAll('rect.handle')).toHaveLength(0);
  });
});

describe('RssiTrace scale', () => {
  it('spans the chosen seconds and scrolls when the capture is longer', async () => {
    const times = Array.from({ length: 200 }, (_, i) => i); // 200 s of 1 Hz
    const values = times.map(() => 20);
    const { container, getByRole } = render(RssiTrace, {
      trace: { times, values },
      enter: 70,
      exit: 50
    });
    // default 60 s window → a scroll control exists and the right axis label reads 60.0s
    expect(container.querySelector('input.scroll')).not.toBeNull();
    expect(container.textContent).toContain('60.0s');
    // Fit → no scroll, right label is the whole span
    await (getByRole('button', { name: 'Fit' }) as HTMLButtonElement).click();
    expect(container.textContent).toContain('199.0s');
  });
});
