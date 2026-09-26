import { Fragment, type ReactNode } from 'react';

/**
 * A help article's section, from the markdown the knowledge base is written in (T-059) — the
 * subset it uses and nothing more: paragraphs, flat lists (a continuation line is indented),
 * tables, quotes, **bold** and `code`. The knowledge base has no links, images or HTML, and none
 * is interpreted: every character is text, which React escapes, so an article cannot inject markup.
 */
export function ArticleBody({ markdown }: { markdown: string }) {
  return (
    <div className="grid gap-3">
      {blocks(markdown).map((block, i) => (
        <Fragment key={i}>{render(block)}</Fragment>
      ))}
    </div>
  );
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

const LIST_ITEM = /^(?:[-*]|(\d+)\.) +(.*)$/;

/** Lines into blocks: a blank line ends one; a list, a quote or a table runs while its lines do. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const chunk of markdown.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const first = lines[0]!;
    if (LIST_ITEM.test(first)) {
      const items: string[] = [];
      for (const line of lines) {
        const item = LIST_ITEM.exec(line);
        if (item !== null) items.push(item[2]!);
        else items[items.length - 1] += ` ${line.trim()}`;
      }
      out.push({ kind: 'list', ordered: /^\d/.test(first), items });
    } else if (first.startsWith('>')) {
      out.push({ kind: 'quote', text: lines.map((l) => l.replace(/^>\s?/, '')).join(' ') });
    } else if (first.startsWith('|')) {
      const cells = (l: string) =>
        l
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const [head, , ...rows] = lines;
      out.push({ kind: 'table', head: cells(head!), rows: rows.map(cells) });
    } else {
      out.push({ kind: 'paragraph', text: lines.map((l) => l.trim()).join(' ') });
    }
  }
  return out;
}

function render(block: Block): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return <p>{inline(block.text)}</p>;
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-3 text-text-muted">
          {inline(block.text)}
        </blockquote>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={`grid gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </List>
      );
    }
    case 'table':
      return (
        // A table scrolls in its own box on a phone; the page never does (responsive-design).
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} className="border-b border-border px-2 py-2 text-left font-medium">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-border px-2 py-2 align-top">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** **Bold** and `code` within a line; everything else as it is. */
export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={i} className="rounded-sm bg-surface-sunken px-1 font-mono text-sm">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
