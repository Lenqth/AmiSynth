import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app') });

// Handy for scripting / LLM automation from the devtools console.
import { engine } from './lib/engine.js';
import { app, setParam } from './lib/state.svelte.js';
window.amisynth = { engine, app, setParam };
