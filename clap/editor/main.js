import { mount } from 'svelte';
import '../../src/app.css';
import Editor from './Editor.svelte';
mount(Editor, { target: document.getElementById('app') });
