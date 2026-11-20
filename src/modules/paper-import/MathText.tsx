import { useEffect, useState } from 'react';
import './mathText.css';

interface MathPart {
  text: string;
  math: boolean;
  display: boolean;
}

const DELIMITED_MATH =
  /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?!\$)[^\n$]+?(?<!\\)\$/gu;
const BIG_O = /O\(([A-Za-z][A-Za-z0-9_{}^*+\-=<>/,.\s]{2,120})\)/gu;

function plainParts(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BIG_O)) {
    const token = match[0];
    const index = match.index;
    const expression = match[1];
    if (!expression || !/[_^=*+\-/]/u.test(expression)) continue;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), math: false, display: false });
    parts.push({
      text: `O\\left(${expression.replace(/\s*\*\s*/gu, ' \\cdot ')}\\right)`,
      math: true,
      display: false,
    });
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), math: false, display: false });
  return parts.length ? parts : [{ text, math: false, display: false }];
}

function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(DELIMITED_MATH)) {
    const token = match[0];
    const index = match.index;
    if (index > cursor) parts.push(...plainParts(text.slice(cursor, index)));
    const display = token.startsWith('$$') || token.startsWith('\\[');
    const delimiterLength =
      token.startsWith('$$') || token.startsWith('\\[') || token.startsWith('\\(') ? 2 : 1;
    parts.push({
      text: token.slice(delimiterLength, -delimiterLength),
      math: true,
      display,
    });
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push(...plainParts(text.slice(cursor)));
  return parts.length ? parts : plainParts(text);
}

function renderMath(katexModule: typeof import('katex'), text: string, display: boolean): string | null {
  try {
    return katexModule.default.renderToString(text, {
      displayMode: display,
      output: 'htmlAndMathml',
      strict: 'ignore',
      throwOnError: true,
      trust: false,
    });
  } catch {
    return null;
  }
}

/** Renders delimited LaTeX and common extracted Big-O notation without changing stored source text. */
export function MathText({ text }: { text: string }) {
  const needsMath = /[$\\]|O\(/u.test(text);
  const [rendered, setRendered] = useState<{
    source: string;
    parts: (MathPart & { html?: string | null })[];
  } | null>(null);

  useEffect(() => {
    if (!needsMath) return;
    let active = true;
    void Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([katexModule]) => {
        const parts = splitMath(text).map((part) =>
          part.math ? { ...part, html: renderMath(katexModule, part.text, part.display) } : part,
        );
        if (active) setRendered({ source: text, parts });
      })
      .catch(() => {
        if (active) setRendered({ source: text, parts: [{ text, math: false, display: false }] });
      });
    return () => {
      active = false;
    };
  }, [needsMath, text]);

  if (!needsMath) return text;
  if (rendered?.source !== text) return text;
  return (
    <>
      {rendered.parts.map((part, index) => {
        if (!part.math) return <span key={index}>{part.text}</span>;
        const html = part.html;
        if (!html) return <span key={index}>{part.text}</span>;
        return (
          <span
            key={index}
            className={part.display ? 'paperMathDisplay' : 'paperMath'}
            role="math"
            aria-label={part.text}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </>
  );
}
