import path from 'node:path';

export default {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: { internal: 'Import another feature module through its public index: {{target}}.' },
  },
  create(context) {
    const allowed = new Set(context.options[0]?.allow ?? []);
    const modulesRoot = path.resolve('src/modules');
    const importer = path.relative(modulesRoot, context.filename).replaceAll('\\', '/');
    const ownModule = importer.split('/')[0];
    function check(node) {
      if (typeof node.value !== 'string') return;
      const specifier = node.value;
      let target;
      if (specifier.startsWith('@/modules/')) {
        target = specifier.slice('@/modules/'.length);
      } else if (specifier.startsWith('.')) {
        target = path.relative(modulesRoot, path.resolve(path.dirname(context.filename), specifier));
        target = target.replaceAll('\\', '/');
      } else return;
      const parts = target.split('/');
      if (parts[0] === '..' || parts[0] === ownModule || parts.length < 2) return;
      if (parts.length === 2 && parts[1] === 'index') return;
      if (!allowed.has(`${importer} -> ${target}`))
        context.report({ node, messageId: 'internal', data: { target } });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => node.source && check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression: (node) => {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1
        )
          check(node.arguments[0]);
      },
    };
  },
};
