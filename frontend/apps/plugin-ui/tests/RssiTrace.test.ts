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
    expect(container.querySelector('polyline.rssi')).not.toBeNull();
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
