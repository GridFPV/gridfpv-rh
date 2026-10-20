import { mount } from 'svelte';
// The component library's design tokens — imported once so every widget themes off the
// same CSS custom properties — then the app's own base on top.
import '@gridfpv/components/tokens.css';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('plugin-ui: #app mount target not found');
}

export default mount(App, { target });
