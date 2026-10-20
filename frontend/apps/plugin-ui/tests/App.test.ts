import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from '../src/App.svelte';
import { rh } from '../src/lib/rh.svelte.js';

describe('App shell', () => {
  it('shows the connecting state before the socket is up', () => {
    render(App, { autoconnect: false });
    expect(screen.getByText('GridFPV')).toBeInTheDocument();
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(screen.getByText(/Connecting to the timer/)).toBeInTheDocument();
  });

  it('renders the hello-ack facts once the plugin answers', async () => {
    const state = rh();
    state.connection = 'connected';
    state.hello = {
      plugin_version: '0.1.0',
      rhapi_version: '1.4',
      rh_version: '4.4.0',
      seat_count: 8,
      redirect_home: true
    };
    render(App, { autoconnect: false });
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('4.4.0')).toBeInTheDocument();
    expect(screen.getByText('1.4')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('opens GridFPV')).toBeInTheDocument();
  });
});
