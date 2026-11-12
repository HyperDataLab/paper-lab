import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
const config = ts.readConfigFile('tsconfig.app.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const files = parsed.fileNames.filter((file) => !file.endsWith('.d.ts')).map((file) => path.resolve(file));
const fileSet = new Set(files);
const graph = new Map();
for (const file of files) {
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`Cannot read ${file}`);
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  const edges = new Set();
  for (const imported of imports) {
    const resolved = ts.resolveModuleName(imported.fileName, file, parsed.options, ts.sys).resolvedModule;
    if (resolved) {
      const target = path.resolve(resolved.resolvedFileName);
      if (fileSet.has(target)) edges.add(target);
    }
  }
  graph.set(file, [...edges].sort());
}

// Strongly connected components describe every cyclic group, including overlapping cycles.
const indices = new Map();
const low = new Map();
const stack = [];
const onStack = new Set();
const cycles = [];
let index = 0;
function visit(file) {
  indices.set(file, index);
  low.set(file, index++);
  stack.push(file);
  onStack.add(file);
  for (const next of graph.get(file)) {
    if (!indices.has(next)) {
      visit(next);
      low.set(file, Math.min(low.get(file), low.get(next)));
    } else if (onStack.has(next)) low.set(file, Math.min(low.get(file), indices.get(next)));
  }
  if (low.get(file) !== indices.get(file)) return;
  const component = [];
  let member;
  do {
    member = stack.pop();
    onStack.delete(member);
    component.push(member);
  } while (member !== file);
  if (component.length > 1 || graph.get(file).includes(file)) cycles.push(component.sort());
}
for (const file of [...files].sort()) if (!indices.has(file)) visit(file);
const display = (file) => path.relative(root, file).replaceAll('\\', '/');
cycles.sort((a, b) => a[0].localeCompare(b[0]));
for (const [i, component] of cycles.entries()) {
  const members = new Set(component);
  console.log(`Cycle group ${i + 1}:`);
  for (const file of component) {
    for (const target of graph.get(file).filter((edge) => members.has(edge))) {
      console.log(`  ${display(file)} -> ${display(target)}`);
    }
  }
}
console.log(`${cycles.length} cyclic component(s) in ${files.length} source files.`);
if (cycles.length) process.exitCode = 1;
