import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import CalloutsPanel from '../src/components/CalloutsPanel.svelte';

describe('CalloutsPanel', () => {
  it("lists RotorHazard's callouts, plays one, and saves the trimmed non-empty list on edit, add and delete", async () => {
    const onsave = vi.fn();
    const onplay = vi.fn();
    const { container, getByLabelText, getByText } = render(CalloutsPanel, {
      callouts: ['Pilots to the line', 'Thirty seconds'],
      onsave,
      onplay
    });
    const inputs = () => Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs().map((i) => i.value)).toEqual(['Pilots to the line', 'Thirty seconds']);

    await fireEvent.click(getByLabelText('Play callout 2'));
    expect(onplay).toHaveBeenCalledWith('Thirty seconds');

    await fireEvent.input(inputs()[0], { target: { value: '  Arm your quads  ' } });
    await fireEvent.change(inputs()[0]);
    expect(onsave).toHaveBeenLastCalledWith(['Arm your quads', 'Thirty seconds']);

    await fireEvent.click(getByText('Add callout'));
    expect(inputs()).toHaveLength(3);
    await fireEvent.change(inputs()[2]); // empty line: not saved
    expect(onsave).toHaveBeenLastCalledWith(['Arm your quads', 'Thirty seconds']);

    await fireEvent.click(getByLabelText('Delete callout 1'));
    expect(onsave).toHaveBeenLastCalledWith(['Thirty seconds']);
    expect(inputs()).toHaveLength(2);
  });
});
