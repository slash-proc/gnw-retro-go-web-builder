const fs = require('fs');
let file = fs.readFileSync('apps/web/src/styles/global.css', 'utf-8');

file = file.replace(
  'html,\nbody {\n  margin: 0;\n  padding: 0;\n}',
  'html,\nbody {\n  margin: 0;\n  padding: 0;\n}\n\nhtml {\n  overflow-y: scroll;\n  scrollbar-gutter: stable;\n}'
);

fs.writeFileSync('apps/web/src/styles/global.css', file);
