/**
 * @gridfpv/components — the GridFPV Svelte 5 component library.
 *
 * Design tokens plus the framework-pure base primitives, carried over from GridFPV's
 * console so the plugin UI looks and behaves the same and work ports back. Components
 * style themselves only through the custom properties in `tokens.css`; a surface imports
 * that stylesheet once:
 *   import '@gridfpv/components/tokens.css';
 *
 * Race-domain widgets (leaderboards, heat sheets, …) are added here as they are rebuilt
 * over RotorHazard's data shapes.
 */

// Base UI primitives (framework-pure, token-styled)
export { default as Button } from './primitives/Button.svelte';
export { default as Field } from './primitives/Field.svelte';
export { default as Input } from './primitives/Input.svelte';
export { default as Select } from './primitives/Select.svelte';
export { default as Card } from './primitives/Card.svelte';
export { default as Collapsible } from './primitives/Collapsible.svelte';
export { default as Badge } from './primitives/Badge.svelte';
export { default as InfoTip } from './primitives/InfoTip.svelte';
export { default as StatusPill } from './primitives/StatusPill.svelte';
export { default as Tabs } from './primitives/Tabs.svelte';
export { default as Banner } from './primitives/Banner.svelte';
export { default as Dialog } from './primitives/Dialog.svelte';
export { default as ToastHost } from './primitives/ToastHost.svelte';
export { toast, toasts, type Toast, type ToastTone } from './primitives/toast.svelte.js';

// Presentational helpers (pure, framework-agnostic)
export { formatClock, formatMicros, medalFor } from './format.js';
