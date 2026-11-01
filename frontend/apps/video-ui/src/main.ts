import { mount } from 'svelte';
import '@gridfpv/components/tokens.css';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('video-ui: #app mount target not found');

export default mount(App, { target });
