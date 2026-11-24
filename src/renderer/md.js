'use strict';
/* Xavfsiz mini-markdown: avval hamma narsa escape qilinadi. */
(function (g) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inline(s) {
    return s.split(/(`[^`]+`)/).map((p) => {
      if (p.length > 2 && p[0] === '`' && p[p.length - 1] === '`') return '<code>' + p.slice(1, -1) + '</code>';
      return p.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" data-link="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    }).join('');
  }
  function md(src) {
    const out = [], lines = esc(src).split('\n');
    let list = '', para = [], i = 0;
    const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } if (list) { out.push('</' + list + '>'); list = ''; } };
    for (; i < lines.length; i++) {
      const l = lines[i]; let m;
      if (/^\s*```/.test(l)) {
        flush(); const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push('<pre><code>' + code.join('\n') + '</code></pre>');
      } else if ((m = l.match(/^#{1,6}\s+(.*)/))) { flush(); out.push('<h3>' + inline(m[1]) + '</h3>'); }
      else if ((m = l.match(/^\s*([-*•]|\d+[.)])\s+(.*)/))) {
        const t = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (para.length || (list && list !== t)) flush();
        if (!list) { list = t; out.push(t === 'ol' ? `<ol start="${parseInt(m[1], 10)}">` : '<ul>'); }
        out.push('<li>' + inline(m[2]) + '</li>');
      } else if (/^\s*\|.*\|\s*$/.test(l)) {
        flush(); const rows = [];
        for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) if (!/^[\s|:-]+$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|'));
        i--;
        out.push('<table>' + rows.map((r, n) => '<tr>' + r.map((c) => n ? `<td>${inline(c.trim())}</td>` : `<th>${inline(c.trim())}</th>`).join('') + '</tr>').join('') + '</table>');
      } else if (!l.trim()) flush();
      else { if (list) flush(); para.push(l); }
    }
    flush();
    return out.join('');
  }
  g.md = md;
  if (typeof module !== 'undefined') module.exports = md;
})(typeof window !== 'undefined' ? window : globalThis);
