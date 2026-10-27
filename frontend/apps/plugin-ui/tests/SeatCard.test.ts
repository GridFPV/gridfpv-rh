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
      message: "Not written: Enter must be above Exit. Values are RotorHazard's again."
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

describe('SeatCard while a race is on (#87)', () => {
  it('shows "Race on" and keeps the threshold boxes editable', () => {
    const { container, getByText } = render(SeatCard, { seat, raceOn: true, onresult: vi.fn() });
    expect(getByText('Race on')).toBeTruthy();
    expect(inputs(container).map((i) => i.disabled)).toEqual([false, false]);
  });
  it('shows no such badge otherwise', () => {
    const { queryByText } = render(SeatCard, { seat, onresult: vi.fn() });
    expect(queryByText('Race on')).toBeNull();
  });
});

describe('SeatCard enter/exit range (#88)', () => {
  it("refuses an enter above 255 with the reason and shows RotorHazard's value again", async () => {
    const onresult = vi.fn();
    const { container } = render(SeatCard, { seat, onresult });
    const [enter] = inputs(container);
    await fireEvent.input(enter, { target: { value: '300' } });
    await fireEvent.blur(enter, { relatedTarget: null });
    expect(onresult).toHaveBeenCalledWith({
      ok: false,
      message:
        "Not written: Enter must be 255 or less (RSSI levels run 0–255). Values are RotorHazard's again."
    });
    expect(enter.value).toBe('100');
  });
  it('names Enter, not Exit, for an empty Enter', async () => {
    const onresult = vi.fn();
    const { container } = render(SeatCard, { seat, onresult });
    const [enter] = inputs(container);
    await fireEvent.input(enter, { target: { value: '' } });
    await fireEvent.blur(enter, { relatedTarget: null });
    expect(onresult).toHaveBeenCalledWith({
      ok: false,
      message: "Not written: Enter needs a value. Values are RotorHazard's again."
    });
    expect(enter.value).toBe('100');
  });
});
