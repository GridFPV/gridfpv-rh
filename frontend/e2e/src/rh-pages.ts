/**
 * "RotorHazard agrees" (T1, #31): read RotorHazard's own pages after our UI wrote
 * something. Principle 14 of the UI review — everything we write must show up correctly
 * in RotorHazard's pages — as helpers a spec ends with.
 *
 * RotorHazard's Format page is lazy: a collapsed panel asks the server for its data the
 * first time it is opened (`load_required_data` in format.html), so each helper opens the
 * panel by its header and then waits for the rows RotorHazard builds from the socket data.
 */
import { expect, type Page } from '@playwright/test';

export class RhPages {
  constructor(private readonly page: Page) {}

  /** Open one of RotorHazard's collapsing panels by the title in its header. */
  private async openPanel(path: string, title: string): Promise<void> {
    if (!this.page.url().endsWith(path)) await this.page.goto(path);
    const panel = this.page.locator('.panel', {
      has: this.page.locator('.panel-header button', { hasText: title })
    });
    await expect(panel.first()).toBeAttached();
    const content = panel.first().locator('.panel-content');
    if (!(await content.isVisible())) {
      await panel.first().locator('.panel-header button').click();
      await expect(content).toBeVisible();
    }
  }

  private async inputValues(selector: string, usePlaceholder = false): Promise<string[]> {
    const inputs = this.page.locator(selector);
    await expect(inputs.first()).toBeAttached();
    return inputs.evaluateAll(
      (els, usePlaceholder) =>
        els.map((e) => {
          const input = e as HTMLInputElement;
          return usePlaceholder ? input.value || input.placeholder : input.value;
        }),
      usePlaceholder
    );
  }

  /** Callsigns listed on RotorHazard's Format page (Pilots panel), as its inputs hold them. */
  async formatPilotCallsigns(): Promise<string[]> {
    await this.openPanel('/format', 'Pilots');
    return this.inputValues('input.set_pilot_callsign');
  }

  /** Class names on the Format page. */
  async formatClassNames(): Promise<string[]> {
    await this.openPanel('/format', 'Classes and Heats');
    return this.inputValues('input.set_race_class_name');
  }

  /** Heat names on the Format page: the typed name, or the auto name RotorHazard shows instead. */
  async formatHeatNames(): Promise<string[]> {
    await this.openPanel('/format', 'Classes and Heats');
    return this.inputValues('input.set_heat_name', true);
  }

  /** Format names in the Race Formats panel's selector. */
  async formatNames(): Promise<string[]> {
    await this.openPanel('/format', 'Race Formats');
    const options = this.page.locator('#set_race_format option');
    await expect(options.first()).toBeAttached();
    // The selector holds a "Loading..." placeholder until format_data arrives.
    await expect(options.first()).not.toHaveText('Loading...');
    return options.evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
  }

  /**
   * The lap-detection and scoring options as RotorHazard's Format page (Event panel) holds
   * them. The consecutive base is rendered server side; the other three are filled from the
   * `min_lap` message when the page loads, so wait for the behaviour select to have a value.
   */
  async formatEventOptions(): Promise<{
    consecutivesBase: string;
    minLap: string;
    minLapBehavior: string;
    minFirstCrossing: string;
  }> {
    await this.openPanel('/format', 'Event');
    await expect(this.page.locator('#set_min_lap')).not.toHaveValue('');
    return {
      consecutivesBase: await this.page.locator('#set_consecutives_count').inputValue(),
      minLap: await this.page.locator('#set_min_lap').inputValue(),
      minLapBehavior: await this.page.locator('#set_min_lap_behavior').inputValue(),
      minFirstCrossing: await this.page.locator('#set_min_first_crossing').inputValue()
    };
  }

  /** The event name as RotorHazard's Event page renders it (server side, from the option). */
  async eventName(): Promise<string> {
    await this.page.goto('/event');
    return (await this.page.locator('main h2').first().textContent())?.trim() ?? '';
  }

  /** Expect RotorHazard's Results page not to mention `text` anywhere once its data has loaded. */
  async expectResultsNotToMention(text: string, loadedMarker: string): Promise<void> {
    await this.page.goto('/results');
    await expect(this.page.locator('body')).toContainText(loadedMarker, { timeout: 15_000 });
    await expect(this.page.locator('body')).not.toContainText(text);
  }

  /** Expect RotorHazard's Results page to mention `text` somewhere (collapsed rounds included). */
  async expectResultsToMention(text: string): Promise<void> {
    await this.page.goto('/results');
    await expect(this.page.locator('body')).toContainText(text, { timeout: 15_000 });
  }
}
