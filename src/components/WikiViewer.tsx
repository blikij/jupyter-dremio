import * as React from 'react';

interface Props {
  title: string;
  markdown: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function markdownToHtml(md: string): string {
  if (!md.trim()) {
    return '<p><em>No wiki content available for this item.</em></p>';
  }

  let html = '';
  let inCodeBlock = false;
  let inList = false;
  let listTag = 'ul';

  const closeList = () => {
    if (inList) {
      html += `</${listTag}>\n`;
      inList = false;
    }
  };

  for (const line of md.split('\n')) {
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (inCodeBlock) {
        html += '</code></pre>\n';
        inCodeBlock = false;
      } else {
        closeList();
        const lang = fenceMatch[1];
        html += `<pre><code${lang ? ` class="language-${lang}"` : ''}>`;
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html += escapeHtml(line) + '\n';
      continue;
    }

    let m: RegExpMatchArray | null;

    if ((m = line.match(/^(#{1,6})\s+(.+)/))) {
      closeList();
      const level = m[1].length;
      html += `<h${level}>${inlineMarkdown(m[2])}</h${level}>\n`;
      continue;
    }

    if (/^[-*_]{3,}$/.test(line.trim())) {
      closeList();
      html += '<hr>\n';
      continue;
    }

    if ((m = line.match(/^[-*+]\s+(.*)/))) {
      if (!inList || listTag !== 'ul') { closeList(); html += '<ul>\n'; inList = true; listTag = 'ul'; }
      html += `<li>${inlineMarkdown(m[1])}</li>\n`;
      continue;
    }

    if ((m = line.match(/^\d+\.\s+(.*)/))) {
      if (!inList || listTag !== 'ol') { closeList(); html += '<ol>\n'; inList = true; listTag = 'ol'; }
      html += `<li>${inlineMarkdown(m[1])}</li>\n`;
      continue;
    }

    if ((m = line.match(/^>\s*(.*)/))) {
      closeList();
      html += `<blockquote><p>${inlineMarkdown(m[1])}</p></blockquote>\n`;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      html += '\n';
      continue;
    }

    closeList();
    html += `<p>${inlineMarkdown(line)}</p>\n`;
  }

  if (inCodeBlock) html += '</code></pre>\n';
  if (inList) html += `</${listTag}>\n`;

  return html;
}

export function WikiViewer({ title, markdown }: Props): JSX.Element {
  return (
    <div className="dremio-wiki">
      <div className="dremio-wiki-header">
        <span className="dremio-wiki-icon">📄</span>
        <span className="dremio-wiki-title">{title || 'Wiki'}</span>
      </div>
      <div
        className="dremio-wiki-content"
        dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }}
      />
    </div>
  );
}
