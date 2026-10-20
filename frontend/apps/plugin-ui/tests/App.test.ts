import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from '../src/App.svelte';
import { rh } from '../src/lib/rh.svelte.js';
import { go } from '../src/lib/router.svelte.js';

describe('App shell', () => {
  beforeEach(() => {
    const state = rh();
    state.connection = 'connecting';
    state.hello = null;
    state.seats = [];
    state.capture = null;
    go('', true);
  });

  it('shows the connecting state before the socket is up', () => {
    render(App, { autoconnect: false });
    expect(screen.getByText('GridFPV')).toBeInTheDocument();
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(screen.getByText(/Connecting to the timer/)).toBeInTheDocument();
  });

  it('renders the hello-ack facts once the plugin answers', () => {
    const state = rh();
    state.connection = 'connected';
    state.hello = {
      plugin_version: '0.2.0',
      rhapi_version: '1.4',
      rh_version: '4.4.0',
      seat_count: 8,
      redirect_home: true,
      capture: null
    };
    render(App, { autoconnect: false });
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('4.4.0')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('opens GridFPV')).toBeInTheDocument();
  });

  it('routes /grid/seats to the Seats page and /grid/seats/N to tuning', async () => {
    const state = rh();
    state.seats = [
      {
        index: 0,
        frequency: 5658,
        band: 'R',
        channel: 1,
        enter: 70,
        exit: 50,
        rssi: 12,
        nodeFrequency: 5658,
        crossing: false,
        peak: 90,
        nadir: 5,
        passPeak: null,
        passNadir: null
      }
    ];
    state.profiles = {
      list: [{ id: 1, name: 'Default' }],
      currentId: 1,
      name: 'Default',
      description: ''
    };
    go('seats', true);
    const { unmount } = render(App, { autoconnect: false });
    expect(screen.getByRole('heading', { name: 'Seats' })).toBeInTheDocument();
    // The channel label appears on the card and as the selected <option>.
    expect(screen.getAllByText('R1 · 5658').length).toBeGreaterThan(0);
    unmount();

    go('seats/0', true);
    render(App, { autoconnect: false });
    expect(screen.getByRole('heading', { name: /Seat 1/ })).toBeInTheDocument();
    expect(screen.getByText('Start capture')).toBeInTheDocument();
  });
});
