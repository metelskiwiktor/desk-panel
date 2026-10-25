import type { ReactNode } from 'react';

/**
 * The part of Markdown an agent's answer really uses: paragraphs, lists, code, headings, quotes, bold, italics,
 * `code` and http(s) links. Built from React elements, never from HTML, so nothing in the text can run.
 */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}.${n++}`, token = m[0];
    if (m[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    else out.push(<a key={k} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const FENCE = /^\s*```/, HEADING = /^(#{1,4})\s+(.*)$/, BULLET = /^\s*[-*•]\s+(.*)$/, ORDERED = /^\s*\d+[.)]\s+(.*)$/, QUOTE = /^\s*>\s?(.*)$/;
const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i], key = `b${blocks.length}`;
    if (!line.trim()) { i++; continue; }
    if (FENCE.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      i++; // the closing fence; a block still open while the answer streams runs to the end
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push(<p key={key} className="md-h">{inline(heading[2], key)}</p>); i++; continue; }
    const kind = BULLET.test(line) ? BULLET : ORDERED.test(line) ? ORDERED : null;
    if (kind) {
      const items: string[] = [];
      for (; i < lines.length && kind.test(lines[i]); i++) items.push(kind.exec(lines[i])![1]);
      const li = items.map((item, n) => <li key={n}>{inline(item, `${key}.${n}`)}</li>);
      blocks.push(kind === BULLET ? <ul key={key}>{li}</ul> : <ol key={key}>{li}</ol>);
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1]);
      blocks.push(<blockquote key={key}>{inline(quoted.join(' '), key)}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines[i])); i++) paragraph.push(lines[i]);
    blocks.push(<p key={key}>{paragraph.flatMap((l, n) => [...(n ? [<br key={`br${n}`} />] : []), ...inline(l, `${key}.${n}`)])}</p>);
  }
  return <div className="md">{blocks}</div>;
}
