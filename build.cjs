const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');

const read = name => fs.readFileSync(name, 'utf8');

// Figma에 전달할 HTML 문자열에 UI 스타일시트를 포함합니다.
let bundledUi = read('ui.html');
for (const name of ['css/common.css', 'css/ui.css']) {
  const href = name.replace('.', '\\.');
  const stylesheet = new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\./)?${href}["'][^>]*>`, 'i');
  if (!stylesheet.test(bundledUi)) throw new Error(`ui.html must link ${name}.`);
  bundledUi = bundledUi.replace(stylesheet, () => '<style>\n' + read(name).trimEnd() + '\n</style>');
}
const logoPath = 'img/logo.svg';
const logoSource = 'src="' + logoPath + '"';
if (!bundledUi.includes(logoSource)) throw new Error(`ui.html must reference ${logoPath}.`);
const logo = fs.readFileSync(logoPath).toString('base64');
bundledUi = bundledUi.replace(logoSource, () => 'src="data:image/svg+xml;base64,' + logo + '"');

const { outputText } = ts.transpileModule(read('code.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None, alwaysStrict: true }
});
const plugin = outputText.replace(/\b__html__\b/g, () => JSON.stringify(bundledUi));
const stagedOutput = '.code-' + randomUUID() + '.tmp';
try {
  fs.writeFileSync(stagedOutput, plugin);
  fs.renameSync(stagedOutput, 'code.js');
} finally {
  fs.rmSync(stagedOutput, { force: true });
}
console.log('Build complete.');
