const path = require('node:path');
const { pathToFileURL } = require('node:url');
module.exports = (root) => import(pathToFileURL(path.join(root, 'scripts', 'workflow-studio-runtime.mjs')).href);
