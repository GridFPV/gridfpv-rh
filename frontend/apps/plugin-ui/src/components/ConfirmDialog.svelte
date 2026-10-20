<script lang="ts">
  /**
   * An in-app confirmation on the Dialog primitive. Never `window.confirm`: browser dialogs
   * can't be themed, block the whole tab, and behave differently per browser and on phones.
   *
   * Controlled by `open`; `onconfirm` fires on the confirm button, `oncancel` on cancel, ×,
   * Esc or the backdrop.
   */
  import { Button, Dialog } from '@gridfpv/components';

  let {
    open = $bindable(false),
    title,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onconfirm,
    oncancel = undefined,
    children
  }: {
    open?: boolean;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Style the confirm button as destructive. */
    danger?: boolean;
    onconfirm: () => void;
    oncancel?: () => void;
    children: import('svelte').Snippet;
  } = $props();

  function cancel() {
    open = false;
    oncancel?.();
  }
  function confirm() {
    open = false;
    onconfirm();
  }
</script>

<Dialog bind:open {title} onclose={cancel}>
  <div class="body">{@render children()}</div>
  {#snippet footer()}
    <Button variant="ghost" onclick={cancel}>{cancelLabel}</Button>
    <Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel}</Button>
  {/snippet}
</Dialog>

<style>
  .body {
    color: var(--gf-text);
  }
</style>
