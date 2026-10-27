import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

vi.mock('../src/lib/rh.svelte.js', () => ({
  setLevels: vi.fn(async () => ({ ok: true })),
  rh: () => ({ seats: [], profiles: { list: [], currentId: null, name: '', description: '' } })
}));
vi.mock('../src/lib/router.svelte.js', () => ({
  go: vi.fn(),
  href: (p: string) => `/grid/${p}`,
  link: () => undefined
}));

import SeatCard from '../src/components/SeatCard.svelte';
import { emptySeat } from '../src/lib/seats.js';
import { setLevels } from '../src/lib/rh.svelte.js';

const seat = { ...emptySeat(1), frequency: 5695, enter: 100, exit: 80 };
const inputs = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.levels input')) as HTMLInputElement[];

describe('SeatCard enter/exit (#77)', () => {
  it("refuses a pair RotorHazard would not take, says why, and shows RotorHazard's values again", async () => {
    const onresult = vi.fn();
    const { container } = render(SeatCard, { seat, onresult });
    const [enter, exit] = inputs(container);
    expect([enter.value, exit.value]).toEqual(['100', '80']);
    await fireEvent.input(exit, { target: { value: '150' } });
    await fireEvent.blur(exit, { relatedTarget: null });
    expect(onresult).toHaveBeenCalledWith({
      ok: false,
      message: "Not written: Exit must be above 0 and below Enter. Values are RotorHazard's again."
    });
    expect(setLevels).not.toHaveBeenCalled();
    expect([enter.value, exit.value]).toEqual(['100', '80']);
  });
  it('waits while the director tabs from Enter to Exit, then writes a sane pair', async () => {
    const onresult = vi.fn();
    const { container } = render(SeatCard, { seat, onresult });
    const [enter, exit] = inputs(container);
    await fireEvent.input(enter, { target: { value: '70' } }); // below exit for a moment
    await fireEvent.blur(enter, { relatedTarget: exit });
    expect(onresult).not.toHaveBeenCalled();
    expect(enter.value).toBe('70');
    await fireEvent.input(exit, { target: { value: '50' } });
    await fireEvent.blur(exit, { relatedTarget: null });
    expect(setLevels).toHaveBeenCalledWith(1, 70, 50);
  });
});
