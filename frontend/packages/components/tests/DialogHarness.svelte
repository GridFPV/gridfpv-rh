<script lang="ts">
  /** Test harness for Dialog: `open` and `onclose` passed straight through. */
  import Dialog from '../src/primitives/Dialog.svelte';

  let { open = false, onclose = undefined }: { open?: boolean; onclose?: () => void } = $props();
</script>

<Dialog {open} {onclose} title="Seat 1">
  <p>Body</p>
</Dialog>
