const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Ship the same presentation assets without including the main application.
const css = ['globals.css', 'dashboard.css'].map((name) => fs.readFileSync(path.join(root, 'src', 'app', name), 'utf8').replace(/^@import[^\r\n]*/gm, '')).join('\n');
fs.writeFileSync(path.join(root, 'companion', 'studio-theme.css'), css);
for (const name of ['workflow-studio-logo.png', 'workflow-studio-favicon.png']) fs.copyFileSync(path.join(root, 'public', name), path.join(root, 'companion', 'public', name));
