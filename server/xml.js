// Winziger XML-Leser für CalDAV-Antworten – ohne Abhängigkeiten, läuft auch im Browser.
// Namensräume werden bewusst ignoriert: <d:href>, <D:href> und <href xmlns="DAV:"> heißen alle „href“.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const localName = (name) => name.slice(name.lastIndexOf(':') + 1);

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3]);
  }
  return attrs;
}

// Ende eines Start-Tags finden – ein „>“ in Anführungszeichen zählt nicht
function tagEnd(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/**
 * Liest XML und liefert das Wurzelelement.
 * Element: { name (ohne Präfix), qname, attrs, children: Element[], text (direkter Text) }
 */
export function parseXml(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const root = { name: '#document', qname: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      top().text += decodeEntities(text.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(text.slice(i, lt));

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      top().text += text.slice(lt + 9, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (text.startsWith('<!', lt)) {
      // <!DOCTYPE …> – auch mit [interner Teil]
      const bracket = text.indexOf('[', lt);
      const close = text.indexOf('>', lt);
      const end = bracket !== -1 && bracket < close ? text.indexOf(']>', bracket) + 1 : close;
      i = end <= 0 ? text.length : end + 1;
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      const name = localName(text.slice(lt + 2, end === -1 ? text.length : end).trim());
      // Tolerant: bis zum passenden offenen Element schließen
      const at = stack.findLastIndex((el, idx) => idx > 0 && el.name === name);
      if (at > 0) stack.length = at;
      i = end === -1 ? text.length : end + 1;
    } else {
      const end = tagEnd(text, lt + 1);
      if (end === -1) break;
      let src = text.slice(lt + 1, end);
      const selfClosing = src.endsWith('/');
      if (selfClosing) src = src.slice(0, -1);
      const qname = /^[^\s/>]+/.exec(src)?.[0];
      if (qname) {
        const el = { name: localName(qname), qname, attrs: parseAttrs(src.slice(qname.length)), children: [], text: '' };
        top().children.push(el);
        if (!selfClosing) stack.push(el);
      }
      i = end + 1;
    }
  }
  return root.children[0] || null;
}

// Alle Nachfahren in Dokumentreihenfolge (ohne Rekursion, damit tiefe Verschachtelung nichts sprengt)
function* descendants(el) {
  if (!el) return;
  const todo = [...el.children].reverse();
  while (todo.length) {
    const cur = todo.pop();
    yield cur;
    for (let k = cur.children.length - 1; k >= 0; k--) todo.push(cur.children[k]);
  }
}

export function find(el, name) {
  for (const d of descendants(el)) if (d.name === name) return d;
  return null;
}

export function findAll(el, name) {
  const out = [];
  for (const d of descendants(el)) if (d.name === name) out.push(d);
  return out;
}

export function children(el, name) {
  return el ? el.children.filter((c) => name === undefined || c.name === name) : [];
}

// Gesamter Text eines Elements (inkl. Kindelemente), ohne Leerraum am Rand
export function text(el) {
  if (!el) return '';
  let out = el.text;
  for (const d of descendants(el)) out += d.text;
  return out.trim();
}
