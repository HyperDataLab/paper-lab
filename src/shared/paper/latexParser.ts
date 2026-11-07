import { segmentPaper } from '@/core/paper';
import { guardPaperSize } from './sizeGuard';
export async function parseLatex(text: string) {
  guardPaperSize(new TextEncoder().encode(text).length);
  const cleaned = text
    .replace(/(^|[^\\])%.*/gm, '$1')
    .replace(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g, (_match, contents: string) => {
      const caption = /\\caption(?:\[[^\]]*\])?\{([^}]*)\}/.exec(contents)?.[1];
      return caption ? `\n\n\\caption{${caption}}\n\n` : '\n';
    })
    .replace(/\\begin\{thebibliography\}(?:\{[^}]*\})?/g, '\nReferences\n')
    .replace(/\\end\{thebibliography\}/g, '\n')
    .replace(/\\bibitem(?:\[[^\]]*\])?\{[^}]*\}/g, '\n\n')
    .replace(
      /\\begin\{(?:equation|align|displaymath)\*?\}[\s\S]*?\\end\{(?:equation|align|displaymath)\*?\}/g,
      '\n\n[math]\n\n',
    )
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]*\$/g, '[math]')
    .replace(/\\(?:begin|end)\{[^}]*\}/g, '\n')
    .replace(/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\(?:textbf|textit|emph)\{([^}]*)\}/g, '$1');
  return segmentPaper(cleaned);
}
