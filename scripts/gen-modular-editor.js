// Build the existing Svelte rack into one offline page embedded in the CLAP binary.
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({
  configFile: false, root, plugins: [svelte()],
  build: { write: false, minify: true, cssCodeSplit: false,
    lib: { entry: resolve(root, 'clap/editor/main.js'), name: 'AmiSynthEditor', formats: ['iife'] } },
});
const output = (Array.isArray(result) ? result : [result]).flatMap(x => x.output);
const js = output.filter(x => x.type === 'chunk').map(x => x.code).join('\n').replace(/<\/script/gi, '<\\/script');
const css = output.filter(x => x.type === 'asset' && x.fileName.endsWith('.css')).map(x => x.source).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'"><title>AmiSynth Modular</title><style>${css}</style></head><body><div id="app"></div><script>${js}</script></body></html>`;
const chunks = [];
for (let i = 0; i < html.length; i += 8000) chunks.push(`R"AMISYNTH_UI(${html.slice(i, i + 8000)})AMISYNTH_UI"`);
writeFileSync(process.argv[2], `// Generated; do not edit.\n#pragma once\n#include <string>\ninline std::string modular_editor_html() {\nconst char *chunks[] = {${chunks.join(',\n')}};\nstd::string html;\nfor (const auto *chunk : chunks) html += chunk;\nreturn html;\n}\n`);
