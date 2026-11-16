// parse.js — a fast CommonMark 0.31.2 + GFM renderer, byte-compatible with
// marked 18.1.3's default options (gfm on, breaks off, pedantic off, async off).
// Written from the CommonMark and GFM specifications; no third-party code.
// Two phases: block tokenize (collecting link reference definitions first),
// then render, with inline parsing per block. No state is kept between calls.

// ---------------------------------------------------------------- utilities

/** Escape &, <, >, " and ' unconditionally (code content, as marked does). */
function escAll(s) {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) { out += s.slice(last, i) + '&amp;'; last = i + 1; }
    else if (c === 60) { out += s.slice(last, i) + '&lt;'; last = i + 1; }
    else if (c === 62) { out += s.slice(last, i) + '&gt;'; last = i + 1; }
    else if (c === 34) { out += s.slice(last, i) + '&quot;'; last = i + 1; }
    else if (c === 39) { out += s.slice(last, i) + '&#39;'; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}

/** Escape &, <, >, " and ' — but leave an & alone when it starts an
 * entity-like reference (&word;), as marked does. */
function esc(s) {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      let j = i + 1;
      while (j < s.length && isAlnum(s[j])) j++;
      if (j > i + 1 && s[j] === ';') continue;
      out += s.slice(last, i) + '&amp;'; last = i + 1;
    }
    else if (c === 60) { out += s.slice(last, i) + '&lt;'; last = i + 1; }
    else if (c === 62) { out += s.slice(last, i) + '&gt;'; last = i + 1; }
    else if (c === 34) { out += s.slice(last, i) + '&quot;'; last = i + 1; }
    else if (c === 39) { out += s.slice(last, i) + '&#39;'; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}

function isSpace(c) {
  const code = c.charCodeAt(0);
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11 ||
    code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

const ASCII_PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));
/** marked treats punctuation as ASCII punctuation only. */
const NON_WORD_RE = /[^\p{L}\p{N}\s]/u;
/** Unicode punctuation (for emphasis flanking): any non-letter, non-number, non-space. */
function isPunct(c) {
  if (!c) return false;
  if (c < '\u0080') return ASCII_PUNCT.has(c);
  return NON_WORD_RE.test(c);
}
/** ASCII punctuation only (for backslash escapes: only ASCII punctuation is escapable). */
function isAsciiPunct(c) {
  return !!c && c < '\u0080' && ASCII_PUNCT.has(c);
}
function isAlnum(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

/** Backslash-escape processing: \<ascii-punct> becomes the punctuation itself. */
function unescapeMd(s) {
  if (!s.includes('\\')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isAsciiPunct(s[i + 1])) { out += s[i + 1]; i++; }
    else out += s[i];
  }
  return out;
}

// ------------------------------------------------------------- entities

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', iexcl: '¡', cent: '¢',
  pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©',
  ordf: 'ª', laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°',
  plusmn: '±', sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·',
  cedil: '¸', sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾',
  iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì',
  Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó',
  Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú',
  Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è',
  eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  divide: '÷', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  thorn: 'þ', yuml: 'ÿ', Amacr: 'Ā', amacr: 'ā', Abreve: 'Ă', abreve: 'ă', Aogon: 'Ą',
  aogon: 'ą', Cacute: 'Ć', cacute: 'ć', Ccirc: 'Ĉ', ccirc: 'ĉ', Cdot: 'Ċ', cdot: 'ċ',
  Ccaron: 'Č', ccaron: 'č', Dcaron: 'Ď', dcaron: 'ď', Dstrok: 'Đ', dstrok: 'đ',
  Emacr: 'Ē', emacr: 'ē', Edot: 'Ė', edot: 'ė', Eogon: 'Ę', eogon: 'ę', Ecaron: 'Ě',
  ecaron: 'ě', Gcirc: 'Ĝ', gcirc: 'ĝ', Gbreve: 'Ğ', gbreve: 'ğ', Gdot: 'Ġ', gdot: 'ġ',
  Gcedil: 'Ģ', Hcirc: 'Ĥ', hcirc: 'ĥ', Hstrok: 'Ħ', hstrok: 'ħ', Itilde: 'Ĩ',
  itilde: 'ĩ', Imacr: 'Ī', imacr: 'ī', Iogon: 'Į', iogon: 'į', Idot: 'İ', imath: 'ı',
  Jcirc: 'Ĵ', jcirc: 'ĵ', Kcedil: 'Ķ', kcedil: 'ķ', Lacute: 'Ĺ', lacute: 'ĺ',
  Lcedil: 'Ļ', lcedil: 'ļ', Lcaron: 'Ľ', lcaron: 'ľ', Lmidot: 'Ŀ', lmidot: 'ŀ',
  Lstrok: 'Ł', lstrok: 'ł', Nacute: 'Ń', nacute: 'ń', Ncedil: 'Ņ', ncedil: 'ņ',
  Ncaron: 'Ň', ncaron: 'ň', Ntilde: 'Ñ', ntilde2: 'ñ', Omacr: 'Ō', omacr: 'ō',
  Obreve: 'Ŏ', obreve: 'ŏ', Odblac: 'Ő', odblac: 'ő', OElig: 'Œ', oelig: 'œ',
  Racute: 'Ŕ', racute: 'ŕ', Rcedil: 'Ŗ', rcedil: 'ŗ', Rcaron: 'Ř', rcaron: 'ř',
  Sacute: 'Ś', sacute: 'ś', Scirc: 'Ŝ', scirc: 'ŝ', Scedil: 'Ş', scedil: 'ş',
  Scaron: 'Š', scaron: 'š', Tcedil: 'Ţ', tcedil: 'ţ', Tcaron: 'Ť', tcaron: 'ť',
  Tstrok: 'Ŧ', tstrok: 'ŧ', Utilde: 'Ũ', utilde: 'ũ', Umacr: 'Ū', umacr: 'ū',
  Ubreve: 'Ŭ', ubreve: 'ŭ', Uring: 'Ů', uring: 'ů', Udblac: 'Ű', udblac: 'ű',
  Uogon: 'Ų', uogon: 'ų', Wcirc: 'Ŵ', wcirc: 'ŵ', Ycirc: 'Ŷ', ycirc: 'ŷ',
  Yuml: 'Ÿ', Zacute: 'Ź', zacute: 'ź', Zdot: 'Ż', zdot: 'ż', Zcaron: 'Ž', zcaron: 'ž',
  fnof: 'ƒ', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
  Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν',
  Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ',
  Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ',
  delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ',
  sigmaf: 'ς', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ', ensp: ' ', emsp: ' ',
  thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′',
  Prime: '″', lsaquo: '‹', rsaquo: '›', oline: '‾', frasl: '⁄', euro: '€',
  image: 'ℑ', weierp: '℘', real: 'ℜ', trade: '™', alefsym: 'ℵ', larr: '←',
  uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑',
  rArr: '⇒', dArr: '⇓', hArr: '⇔', forall: '∀', part: '∂', exist: '∃', empty: '∅',
  nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑', minus: '−',
  lowast: '∗', radic: '√', prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨',
  cap: '∩', cup: '∪', int: '∫', there4: '∴', sim: '∼', cong: '≅', asymp: '≈',
  ne: '≠', equiv: '≡', le: '≤', ge: '≥', sub: '⊂', sup: '⊃', nsub: '⊄',
  sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '⟨', rang: '⟩',
  loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  HilbertSpace: 'ℋ', DifferentialD: 'ⅆ', ClockwiseContourIntegral: '∲', ngE: '≧̸',
  Tab: '\t', NewLine: '\n', colon: ':', comma: ',', period: '.', semi: ';',
  sol: '/', bsol: '\\', equals: '=', plus: '+', hyphen: '-',quest: '?',commat:'@',
  dollar:'$',percnt:'%',ast:'*',check:'✓',cross:'✗',star:'★',phone:'☎',
  female:'♀',male:'♂',sung:'♪',flat:'♭',natural:'♮',sharp:'♯',copy2:'©',
};

/** Decode one numeric entity starting at src[i] === '&'. Named references are
 * left alone (marked preserves them verbatim). Returns [decoded, length] or null. */
function entityAt(src, i) {
  if (src[i + 1] !== '#') return null;
  let j = i + 2;
  let hex = false;
  if (src[j] === 'x' || src[j] === 'X') { hex = true; j++; }
  const start = j;
  while (j < src.length && /[0-9A-Fa-f]/.test(src[j])) j++;
  if (j === start || src[j] !== ';') return null;
  let cp = parseInt(src.slice(start, j), hex ? 16 : 10);
  if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) return ['�', j - i + 1];
  if (!cp || cp > 0x10ffff) return null;
  return [String.fromCodePoint(cp), j - i + 1];
}

/** Normalize a link label: trim, collapse inner whitespace runs, lowercase. */
function normLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ------------------------------------------------------------ inline tokens
// token kinds: 0 text, 1 code, 2 delimiter, 3 link, 4 image, 5 raw html, 6 br,
// 7 emphasis wrapper (tag em/strong/del)

function cleanHref(href) {
  try { return encodeURI(href).replace(/%25/g, '%'); } catch { return null; }
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*/;
const ATTR = /^\s*[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/;

/** Try to match an inline HTML tag / comment / PI / declaration / CDATA at i. */
function htmlTagAt(src, i) {
  if (src[i] !== '<') return -1;
  const c1 = src[i + 1];
  if (c1 === '!') {
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      return e === -1 ? -1 : e + 3;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      return e === -1 ? -1 : e + 3;
    }
    if (/[A-Za-z]/.test(src[i + 2] || '')) {
      const e = src.indexOf('>', i + 2);
      return e === -1 ? -1 : e + 1;
    }
    return -1;
  }
  if (c1 === '?') {
    const e = src.indexOf('?>', i + 2);
    return e === -1 ? -1 : e + 2;
  }
  if (c1 === '/') {
    const m = TAG_NAME.exec(src.slice(i + 2));
    if (!m) return -1;
    let j = i + 2 + m[0].length;
    while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
    return src[j] === '>' ? j + 1 : -1;
  }
  const m = TAG_NAME.exec(src.slice(i + 1));
  if (!m) return -1;
  let j = i + 1 + m[0].length;
  for (;;) {
    const a = ATTR.exec(src.slice(j));
    if (!a || a[0].length === 0) break;
    j += a[0].length;
  }
  while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
  if (src[j] === '/' && src[j + 1] === '>') return j + 2;
  if (src[j] === '>') return j + 1;
  return -1;
}

/** Try to match an autolink <scheme:...> or <email> at i. Returns {end, href, text} or null. */
function autolinkAt(src, i) {
  if (src[i] !== '<') return null;
  const e = src.indexOf('>', i + 1);
  if (e === -1 || e - i > 320) return null;
  const inner = src.slice(i + 1, e);
  if (/[\s<>]/.test(inner) || inner.length === 0) return null;
  const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(inner);
  if (sm) return { end: e + 1, href: inner, text: inner };
  if (/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(inner)) {
    return { end: e + 1, href: 'mailto:' + inner, text: inner };
  }
  return null;
}

function validDomain(dom) {
  const labels = dom.split('.');
  if (labels.length < 2) return false;
  const last = labels[labels.length - 1];
  if (last.length < 2) return false;
  for (const l of labels) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(l)) return false;
  }
  return true;
}

/** Strip trailing punctuation from a GFM extended autolink match. Returns new end. */
function stripAutolinkTrail(src, start, end) {
  let e = end;
  for (;;) {
    if (e <= start) break;
    const ch = src[e - 1];
    if (ch === '?' || ch === '!' || ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === '*' || ch === '_' || ch === '~' || ch === "'") { e--; continue; }
    if (ch === ')') {
      // drop if the parens in the match are unbalanced
      let depth = 0;
      for (let k = start; k < e; k++) { if (src[k] === '(') depth++; else if (src[k] === ')') depth--; }
      if (depth < 0) { e--; continue; }
      break;
    }
    if (ch === ';') {
      // drop if it ends something that looks like an entity
      let k = e - 2;
      while (k >= start && /[A-Za-z0-9#]/.test(src[k])) k--;
      if (k >= start && src[k] === '&') { e--; continue; }
      break;
    }
    break;
  }
  return e;
}

/** Try a GFM extended autolink (www. / scheme:// / email) at i. Returns {end, href, text} or null. */
function extAutolinkAt(src, i) {
  // www.
  if (src.startsWith('www.', i)) {
    let e = i + 4;
    while (e < src.length && !isSpace(src[e]) && src[e] !== '<') e++;
    const end = stripAutolinkTrail(src, i, e);
    if (end <= i + 4) return null;
    const dom = src.slice(i, end).split(/[\/?#]/)[0];
    if (!validDomain(dom)) return null;
    return { end, href: 'http://' + src.slice(i, end), text: src.slice(i, end) };
  }
  // scheme://
  const sm = /^(?:https?|ftp):\/\//.exec(src.slice(i));
  if (sm) {
    let e = i + sm[0].length;
    while (e < src.length && !isSpace(src[e]) && src[e] !== '<') e++;
    const end = stripAutolinkTrail(src, i, e);
    const dom = src.slice(i + sm[0].length, end).split(/[\/?#:]/)[0];
    if (!validDomain(dom)) return null;
    return { end, href: src.slice(i, end), text: src.slice(i, end) };
  }
  // email: only when an @ is close ahead
  const at = src.indexOf('@', i);
  if (at !== -1 && at - i < 80 && at > i) {
    const em = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/.exec(src.slice(i));
    if (em) {
      let end = i + em[0].length;
      end = stripAutolinkTrail(src, i, end);
      if (end > i) return { end, href: 'mailto:' + src.slice(i, end), text: src.slice(i, end) };
    }
  }
  return null;
}

/** Find the index of the `]` matching the `[` at i (balanced, code-span aware). */
function findLinkEnd(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length && isAsciiPunct(src[j + 1])) { j += 2; continue; }
    if (c === '`') {
      let k = j;
      while (k < src.length && src[k] === '`') k++;
      const n = k - j;
      let close = -1;
      let p = k;
      while (p < src.length) {
        if (src[p] === '`') {
          let q = p;
          while (q < src.length && src[q] === '`') q++;
          if (q - p === n) { close = q; break; }
          p = q;
        } else p++;
      }
      if (close === -1) return -1;
      j = close;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

/** Parse a link destination starting at i (after '(' or after ':'). Returns {dest, end} or null. */
function parseDest(src, i) {
  let j = i;
  if (src[j] === '<') {
    let k = j + 1;
    let out = '';
    while (k < src.length && src[k] !== '>') {
      const c = src[k];
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && k + 1 < src.length && isAsciiPunct(src[k + 1])) { out += src[k + 1]; k += 2; continue; }
      out += c;
      k++;
    }
    if (k >= src.length) return null;
    return { dest: out, end: k + 1 };
  }
  let depth = 0;
  let out = '';
  let k = j;
  while (k < src.length) {
    const c = src[k];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
    if (c === '\\' && k + 1 < src.length && isAsciiPunct(src[k + 1])) { out += src[k + 1]; k += 2; continue; }
    if (c === '(') { depth++; out += c; k++; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth--; out += c; k++; continue;
    }
    if (c < ' ' ) return null;
    out += c;
    k++;
  }
  if (k === j) return null;
  return { dest: out, end: k };
}

/** Parse a link title starting at i. Returns {title, end} or null. */
function parseTitle(src, i) {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== '(') return null;
  const close = q === '(' ? ')' : q;
  let k = i + 1;
  let out = '';
  while (k < src.length) {
    const c = src[k];
    if (c === close) return { title: out, end: k + 1 };
    if (q === '(' && c === '(') return null;
    if (c === '\\' && k + 1 < src.length && isAsciiPunct(src[k + 1])) { out += src[k + 1]; k += 2; continue; }
    out += c;
    k++;
  }
  return null;
}

/** Skip spaces/tabs/newlines from i. */
function skipWs(src, i) {
  while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++;
  return i;
}

/**
 * Try to parse an inline link or image whose '[' is at i (or '!' at i-1).
 * Returns {href, title, end} or null. `textEnd` is the index of the matching ']'.
 */
function parseLinkTail(src, textEnd, defs, linkText) {
  let j = textEnd + 1;
  if (src[j] === '(') {
    let k = skipWs(src, j + 1);
    if (src[k] === ')') return { href: '', title: null, end: k + 1 };
    const d = parseDest(src, k);
    if (!d) return null;
    k = skipWs(src, d.end);
    let title = null;
    if (src[k] === '"' || src[k] === "'" || src[k] === '(') {
      const t = parseTitle(src, k);
      if (!t) return null;
      title = t.title;
      k = skipWs(src, t.end);
    }
    if (src[k] !== ')') return null;
    return { href: d.dest, title, end: k + 1 };
  }
  if (src[j] === '[') {
    let k = j + 1;
    let label;
    if (src[k] === ']') { label = linkText; k++; }
    else {
      const e = src.indexOf(']', k);
      if (e === -1) return null;
      label = src.slice(k, e);
      k = e + 1;
    }
    const def = defs.get(normLabel(label));
    if (!def) return null;
    return { href: def.dest, title: def.title, end: k };
  }
  // shortcut reference
  const def = defs.get(normLabel(linkText));
  if (!def) return null;
  return { href: def.dest, title: def.title, end: textEnd + 1 };
}

// ---------------------------------------------------------- inline scanner

function flanking(src, start, end) {
  const prev = start > 0 ? src[start - 1] : ' ';
  const next = end < src.length ? src[end] : ' ';
  const prevWs = isSpace(prev);
  const nextWs = isSpace(next);
  const prevPu = !prevWs && isPunct(prev);
  const nextPu = !nextWs && isPunct(next);
  const left = !nextWs && (!nextPu || prevWs || prevPu);
  const right = !prevWs && (!prevPu || nextWs || nextPu);
  return { left, right };
}

/** Tokenize inline content into a flat token list (emphasis not yet paired). */
function tokenizeInline(src, defs) {
  const toks = [];
  let buf = '';
  const flush = () => { if (buf) { toks.push({ k: 0, t: buf }); buf = ''; } };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // newline: hard break if preceded by 2+ spaces, else soft break
    if (c === '\n') {
      let j = buf.length;
      while (j > 0 && buf[j - 1] === ' ') j--;
      if (buf.length - j >= 2) {
        buf = buf.slice(0, j);
        flush();
        toks.push({ k: 6 });
      } else {
        buf += '\n';
      }
      i++;
      continue;
    }
    if (c === '\\') {
      const d = src[i + 1];
      if (d === '\n') { flush(); toks.push({ k: 6 }); i += 2; continue; }
      if (d !== undefined && isAsciiPunct(d)) {
        // an escaped & is its own text token, so it is escaped on its own
        // and cannot join the following text into an entity reference
        if (d === '&') { flush(); toks.push({ k: 0, t: '&' }); }
        else buf += d;
        i += 2; continue;
      }
      buf += '\\';
      i++;
      continue;
    }
    if (c === '`') {
      let j = i;
      while (j < n && src[j] === '`') j++;
      const run = j - i;
      let close = -1;
      let p = j;
      while (p < n) {
        if (src[p] === '`') {
          let q = p;
          while (q < n && src[q] === '`') q++;
          if (q - p === run) { close = q; break; }
          p = q;
        } else p++;
      }
      if (close !== -1) {
        let content = src.slice(j, close - run);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) {
          content = content.slice(1, -1);
        }
        flush();
        toks.push({ k: 1, t: content });
        i = close;
        continue;
      }
      buf += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === '&') {
      const e = entityAt(src, i);
      if (e) {
        if (e[0] === '&') { flush(); toks.push({ k: 0, t: '&' }); }
        else buf += e[0];
        i += e[1]; continue;
      }
      buf += '&';
      i++;
      continue;
    }
    if (c === '<') {
      const a = autolinkAt(src, i);
      if (a) {
        flush();
        const href = cleanHref(a.href);
        if (href === null) { buf += a.text; i = a.end; continue; }
        toks.push({ k: 3, href, title: null, kids: [{ k: 0, t: a.text }] });
        i = a.end;
        continue;
      }
      const h = htmlTagAt(src, i);
      if (h !== -1) { flush(); toks.push({ k: 5, t: src.slice(i, h) }); i = h; continue; }
      buf += '<';
      i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && src[j] === c) j++;
      const run = j - i;
      const { left, right } = flanking(src, i, j);
      let open, close;
      if (c === '_') {
        open = left && (!right || isPunct(src[i - 1] || ' '));
        close = right && (!left || isPunct(src[j] || ' '));
      } else {
        open = left;
        close = right;
      }
      if (!open && !close) { buf += src.slice(i, j); i = j; continue; }
      flush();
      toks.push({ k: 2, ch: c, n: run, open, close });
      i = j;
      continue;
    }
/** True if any token (including inside emphasis wrappers) is a link. */
function hasLink(toks) {
  for (const t of toks) {
    if (t.k === 3) return true;
    if (t.k === 7 && hasLink(t.kids)) return true;
  }
  return false;
}

    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const b = c === '!' ? i + 1 : i;
      const textEnd = findLinkEnd(src, b);
      if (textEnd !== -1) {
        const linkText = src.slice(b + 1, textEnd);
        const tail = parseLinkTail(src, textEnd, defs, linkText);
        if (tail) {
          flush();
          if (c === '!') {
            const alt = plainText(parseInline(linkText, defs));
            const href = cleanHref(tail.href);
            if (href === null) { buf += src.slice(i, tail.end); i = tail.end; continue; }
            toks.push({ k: 4, href, title: tail.title, alt });
          } else {
            const href = cleanHref(tail.href);
            if (href === null) { buf += src.slice(i, tail.end); i = tail.end; continue; }
            const kids = parseInline(linkText, defs);
            if (hasLink(kids)) {
              // links cannot nest: the outer brackets stay literal text
              buf += c;
              i++;
              continue;
            }
            toks.push({ k: 3, href, title: tail.title, kids });
          }
          i = tail.end;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    // GFM extended autolinks at word boundaries
    if ((c === 'w' || c === 'h' || c === 'f') && (i === 0 || isSpace(src[i - 1]) || isPunct(src[i - 1]))) {
      const a = extAutolinkAt(src, i);
      if (a) {
        flush();
        const href = cleanHref(a.href);
        if (href === null) { buf += a.text; i = a.end; continue; }
        toks.push({ k: 3, href, title: null, kids: [{ k: 0, t: a.text }] });
        i = a.end;
        continue;
      }
    }
    if (isAlnum(c) && (i === 0 || isSpace(src[i - 1]) || isPunct(src[i - 1]))) {
      const at = src.indexOf('@', i);
      if (at !== -1 && at - i < 80) {
        const a = extAutolinkAt(src, i);
        if (a) {
          flush();
          const href = cleanHref(a.href);
          if (href === null) { buf += a.text; i = a.end; continue; }
          toks.push({ k: 3, href, title: null, kids: [{ k: 0, t: a.text }] });
          i = a.end;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return toks;
}

/** Pair emphasis delimiters in a token list (CommonMark delimiter-stack algorithm). */
function processEmphasis(toks) {
  const stack = []; // delimiter token objects that can open, in document order
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k !== 2) continue;
    if (t.close) {
      let opener = null;
      for (let s = stack.length - 1; s >= 0; s--) {
        const o = stack[s];
        if (o.ch !== t.ch) continue;
        const sum = o.n + t.n;
        if (sum % 3 === 0 && (o.n % 3 !== 0 || t.n % 3 !== 0)) continue;
        opener = o;
        break;
      }
      if (opener) {
        const oIdx = toks.indexOf(opener);
        const use = opener.n >= 2 && t.n >= 2 ? 2 : 1;
        const tag = t.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
        const kids = toks.slice(oIdx + 1, idx);
        const wrap = { k: 7, tag, kids };
        opener.n -= use;
        t.n -= use;
        const mid = [];
        if (opener.n > 0) mid.push(opener);
        mid.push(wrap);
        if (t.n > 0) mid.push(t);
        // delimiters that were between opener and closer now live inside kids
        const inside = new Set(kids);
        for (let s = stack.length - 1; s >= 0; s--) {
          if (inside.has(stack[s])) stack.splice(s, 1);
        }
        if (opener.n === 0) {
          const si = stack.indexOf(opener);
          if (si !== -1) stack.splice(si, 1);
        }
        toks.splice(oIdx, idx - oIdx + 1, ...mid);
        if (t.n > 0) {
          // the closer still has delimiters: re-process it as a closer so
          // it can pair with an earlier opener (e.g. `_a __b___` nests
          // em around strong instead of leaving a literal `_`)
          idx = oIdx + mid.length - 2;
        } else {
          idx = oIdx + mid.length - 1;
        }
        continue;
      }
      if (t.open) {
        stack.push(t);
      }
    } else if (t.open) {
      stack.push(t);
    }
  }
  // drop remaining delimiter tokens into plain text
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 2) toks[i] = { k: 0, t: t.ch.repeat(t.n) };
  }
  return toks;
}

/** Full inline parse: tokenize, pair emphasis, return tokens. */
function parseInline(src, defs) {
  return processEmphasis(tokenizeInline(src, defs));
}

/** Render inline tokens to a plain-text string (for image alt text). */
function plainText(toks) {
  let out = '';
  for (const t of toks) {
    if (t.k === 0 || t.k === 1) out += t.t;
    else if (t.k === 3) out += plainText(t.kids);
    else if (t.k === 4) out += t.alt;
    else if (t.k === 5) out += '';
    else if (t.k === 6) out += '\n';
    else if (t.k === 7) out += plainText(t.kids);
  }
  return out;
}

/** Render inline tokens to HTML. */
function renderInline(toks) {
  let out = '';
  for (const t of toks) {
    if (t.k === 0) out += esc(t.t);
    else if (t.k === 1) out += '<code>' + escAll(t.t) + '</code>';
    else if (t.k === 3) {
      out += '<a href="' + esc(t.href) + '"';
      if (t.title !== null && t.title !== undefined) out += ' title="' + esc(t.title) + '"';
      out += '>' + renderInline(t.kids) + '</a>';
    } else if (t.k === 4) {
      out += '<img src="' + esc(t.href) + '" alt="' + esc(t.alt) + '"';
      if (t.title !== null && t.title !== undefined) out += ' title="' + esc(t.title) + '"';
      out += '>';
    } else if (t.k === 5) out += t.t;
    else if (t.k === 6) out += '<br>';
    else if (t.k === 7) out += '<' + t.tag + '>' + renderInline(t.kids) + '</' + t.tag + '>';
  }
  return out;
}

/** Inline-parse a string straight to HTML. */
function inlineHtml(src, defs) {
  return renderInline(parseInline(src, defs));
}

// ------------------------------------------------------------ block parser

function lineIndent(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return { col, idx: i };
}

function isBlank(line) {
  return lineIndent(line).idx === line.length;
}

/** Expand the leading whitespace of line starting at index i (at original
 * column col) into spaces, and append the rest of the line. `prefix` spaces
 * (from a partially consumed tab) go first. */
function expandLeadingFrom(line, i, col, prefix) {
  let out = ' '.repeat(prefix);
  let c = col;
  let j = i;
  while (j < line.length) {
    const ch = line[j];
    if (ch === ' ') { out += ' '; c++; j++; }
    else if (ch === '\t') { const w = 4 - (c % 4); out += ' '.repeat(w); c += w; j++; }
    else break;
  }
  return out + line.slice(j);
}

/** Remove n columns from the start of a line (partial tabs become spaces).
 * The line's first character sits at column startCol. When the strip is not
 * a multiple of 4 columns, a surviving tab's width would shift, so the
 * remaining leading whitespace is expanded to spaces on original columns. */
function stripCols(line, n, startCol = 0) {
  let col = startCol;
  let i = 0;
  while (i < line.length && col - startCol < n) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w - startCol > n) {
        return expandLeadingFrom(line, i + 1, col + w, col + w - startCol - n);
      }
      col += w; i++;
    } else break;
  }
  if (n % 4 !== 0 && i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    return expandLeadingFrom(line, i, col, 0);
  }
  return line.slice(i);
}

/** Expand leading tabs of s (whose first character is at column startCol) into spaces. */
function expandLeadingTabs(s, startCol) {
  let col = startCol;
  let i = 0;
  let out = '';
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { out += ' '; col++; i++; }
    else if (c === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
    else break;
  }
  return out + s.slice(i);
}

function isHr(content) {
  const c = content[0];
  if (c !== '*' && c !== '-' && c !== '_') return false;
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === c) count++;
    else if (ch !== ' ' && ch !== '\t') return false;
  }
  return count >= 3;
}

function isFence(content) {
  const c = content[0];
  if (c !== '`' && c !== '~') return null;
  let j = 0;
  while (j < content.length && content[j] === c) j++;
  if (j < 3) return null;
  const info = content.slice(j).trim();
  if (c === '`' && info.includes('`')) return null;
  return { char: c, len: j, info };
}

function matchATX(content) {
  if (content[0] !== '#') return null;
  let j = 0;
  while (j < content.length && content[j] === '#') j++;
  if (j > 6) return null;
  if (j < content.length && content[j] !== ' ' && content[j] !== '\t') return null;
  let rest = content.slice(j);
  // closing sequence: a run of #s preceded by space/tab, at the end
  rest = rest.replace(/[ \t]+#+[ \t]*$/, '');
  const text = rest.trim();
  return { level: j, text };
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

/** HTML block start at a line's content. inPara: type 7 cannot interrupt a paragraph. */
function htmlBlockStart(content, inPara) {
  if (content[0] !== '<') return null;
  const lower = content.toLowerCase();
  const m1 = /^<(script|pre|style|textarea)([\s>]|$)/.exec(lower);
  if (m1) return { type: 1, end: m1[1] };
  if (lower.startsWith('<!--')) return { type: 2, end: '-->' };
  if (lower.startsWith('<?')) return { type: 3, end: '?>' };
  if (/^<![A-Za-z]/.test(content)) return { type: 4, end: '>' };
  if (lower.startsWith('<![cdata[')) return { type: 5, end: ']]>' };
  const m6 = /^<\/?([A-Za-z][A-Za-z0-9-]*)([\s\/>]|$)/.exec(content);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) return { type: 6 };
  if (!inPara && /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>[ \t]*$/.test(content)) {
    return { type: 7 };
  }
  return null;
}

function parseHtmlBlock(lines, i, end, start) {
  const text = [];
  let k = i;
  if (start.type === 1) {
    const endTag = '</' + start.end;
    while (k < end) {
      text.push(lines[k]);
      if (lines[k].toLowerCase().includes(endTag)) { k++; break; }
      k++;
    }
  } else if (start.type >= 2 && start.type <= 5) {
    while (k < end) {
      text.push(lines[k]);
      if (lines[k].includes(start.end)) { k++; break; }
      k++;
    }
  } else {
    while (k < end && !isBlank(lines[k])) { text.push(lines[k]); k++; }
  }
  // trailing newline: present when the line after the block's last line is
  // not blank (the block ended at a terminator with more content after it);
  // absent when the next line is blank, or when the block runs to the end
  // of a sub-parse; at the top level it is present iff the input ends with
  // a newline
  let trailing = '';
  if (k < end) trailing = isBlank(lines[k]) ? '' : '\n';
  else trailing = (HTML_AT_TOP && SRC_ENDS_NL) ? '\n' : '';
  return { tok: { t: 'html', text: text.join('\n') + trailing }, next: k };
}

let SRC_ENDS_NL = false;
let HTML_AT_TOP = false;

/** Scan a [...] label starting at s[i] === '['; return index just past ']' or -1. */
function scanLabel(s, i) {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && isAsciiPunct(s[j + 1])) { j += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return -1;
}

/** Try to parse a link reference definition starting at lines[i]. Returns next index or -1. */
function tryDef(lines, i, end, defs) {
  if (i >= end) return -1;
  const line = lines[i];
  const { col, idx } = lineIndent(line);
  if (col > 3 || line[idx] !== '[') return -1;
  let labelEnd = scanLabel(line, idx);
  let labelText = line;
  let li0 = i;
  while (labelEnd === -1 && li0 + 1 < end) {
    const nl = lines[li0 + 1];
    if (nl.trim() === '') break;
    labelText += '\n' + nl;
    li0++;
    labelEnd = scanLabel(labelText, idx);
  }
  if (labelEnd === -1) return -1;
  const label = labelText.slice(idx + 1, labelEnd - 1);
  if (!label.trim() || label.length > 999) return -1;
  if (labelText[labelEnd] !== ':') return -1;
  let li = li0;
  let cur = lines[li0];
  let pos = labelEnd - (labelText.length - cur.length) + 1;
  while (pos < cur.length && (cur[pos] === ' ' || cur[pos] === '\t')) pos++;
  if (pos >= cur.length) {
    if (li + 1 >= end) return -1;
    const nl = lines[li + 1];
    const ni = lineIndent(nl);
    if (ni.idx === nl.length) return -1;
    cur = nl.slice(ni.idx);
    pos = 0;
    li++;
  }
  const d = parseDest(cur, pos);
  if (!d) return -1;
  let dest = d.dest;
  pos = d.end;
  let title = null;
  let p2 = pos;
  while (p2 < cur.length && (cur[p2] === ' ' || cur[p2] === '\t')) p2++;
  if (p2 >= cur.length) {
    if (li + 1 < end) {
      const nl = lines[li + 1];
      const ni = lineIndent(nl);
      if (ni.idx < nl.length) {
        const s = nl.slice(ni.idx);
        const t = parseTitle(s, 0);
        if (t) {
          let q = t.end;
          while (q < s.length && (s[q] === ' ' || s[q] === '\t')) q++;
          if (q === s.length) { title = t.title; li++; }
        }
      }
    }
  } else {
    // a title must be separated from the destination by whitespace
    if (p2 === pos) return -1;
    let t = parseTitle(cur, p2);
    if (!t) {
      // title may continue on following lines (cm-196)
      let joined = cur.slice(p2);
      let lj = li;
      while (!t && lj + 1 < end) {
        const nl = lines[lj + 1];
        if (nl.trim() === '') break;
        joined += '\n' + nl;
        lj++;
        t = parseTitle(joined, 0);
      }
      if (!t) return -1;
      let q = t.end;
      while (q < joined.length && (joined[q] === ' ' || joined[q] === '\t')) q++;
      if (q !== joined.length) return -1;
      title = t.title;
      li = lj;
    } else {
      title = t.title;
      let q = t.end;
      while (q < cur.length && (cur[q] === ' ' || cur[q] === '\t')) q++;
      if (q !== cur.length) return -1;
    }
  }
  if (!defs.has(normLabel(label))) defs.set(normLabel(label), { dest, title });
  return li + 1;
}

/** Is this line a paragraph continuation line (for laziness)? A line that
 * cannot interrupt a paragraph is a continuation; a list that CAN interrupt
 * (non-empty bullet, or ordered starting with 1) is not. */
function isParaLike(content) {
  if (!content || isBlank(content)) return false;
  const { col, idx } = lineIndent(content);
  const c = content.slice(idx);
  if (col > 3) return true;
  if (matchATX(c)) return false;
  if (isFence(c)) return false;
  if (isHr(c)) return false;
  if (c[0] === '>') return false;
  if (htmlBlockStart(c, false)) return false;
  const m = parseMarker(c, col);
  if (m && canInterruptList(c, col, m)) return false;
  return true;
}

/** True if a line can be a lazy continuation inside a blockquote or list
 * item: it does not start any new block. Unlike isParaLike, ANY list marker
 * breaks the container (marked treats a list that could not interrupt a
 * paragraph as a new block here, e.g. `2. bar` after `> foo` is a list). */
function isLazyLine(content) {
  if (!content || isBlank(content)) return false;
  const { col, idx } = lineIndent(content);
  const c = content.slice(idx);
  if (col > 3) return true;
  if (matchATX(c)) return false;
  if (isFence(c)) return false;
  if (isHr(c)) return false;
  if (c[0] === '>') return false;
  if (htmlBlockStart(c, false)) return false;
  if (parseMarker(c, col)) return false;
  return true;
}

/** True if a line is a setext heading underline (after stripping ≤3 indent). */
function isSetextLine(content) {
  if (!content || isBlank(content)) return false;
  const { col, idx } = lineIndent(content);
  if (col > 3) return false;
  return /^[=-]+[ \t]*$/.test(content.slice(idx));
}

/** Parse a list marker at the start of content (indent col). Returns marker info or null. */
function parseMarker(content, baseCol) {
  const b = content[0];
  if ((b === '-' || b === '+' || b === '*') && (content.length === 1 || content[1] === ' ' || content[1] === '\t')) {
    let ws = 0;
    let j = 1;
    while (j < content.length && (content[j] === ' ' || content[j] === '\t')) {
      ws += content[j] === '\t' ? 4 - ((baseCol + 1 + ws) % 4) : 1;
      j++;
    }
    // an item whose first line holds only the marker takes the default
    // content indent; the spaces after the marker do not count
    if (j >= content.length) return { ordered: false, bullet: b, contentIndent: 2, startNum: 1, delim: '', markerLen: 1 };
    const contentIndent = ws === 0 ? 2 : (ws <= 4 ? 1 + ws : 2);
    return { ordered: false, bullet: b, contentIndent, startNum: 1, delim: '', markerLen: 1 };
  }
  const m = /^(\d{1,9})([.)])(?:[ \t]|$)/.exec(content);
  if (!m) return null;
  const markerLen = m[1].length + 1;
  let ws = 0;
  let j = markerLen;
  while (j < content.length && (content[j] === ' ' || content[j] === '\t')) {
    ws += content[j] === '\t' ? 4 - ((baseCol + markerLen + ws) % 4) : 1;
    j++;
  }
  // an item whose first line holds only the marker takes the default
  // content indent; the spaces after the marker do not count
  if (j >= content.length) return { ordered: true, bullet: '', contentIndent: markerLen + 1, startNum: parseInt(m[1], 10), delim: m[2], markerLen };
  const contentIndent = ws === 0 ? markerLen + 1 : (ws <= 4 ? markerLen + ws : markerLen + 1);
  return { ordered: true, bullet: '', contentIndent, startNum: parseInt(m[1], 10), delim: m[2], markerLen };
}

/** The item content of a marker line: the marker and its indent removed. */
function markerRest(content, baseCol, m) {
  return stripCols(content.slice(m.markerLen), m.contentIndent - m.markerLen, baseCol + m.markerLen);
}

function sameMarker(a, b) {
  if (a.ordered !== b.ordered) return false;
  return a.ordered ? a.delim === b.delim : a.bullet === b.bullet;
}

/** Can this list marker interrupt a paragraph? Needs non-empty first item. */
function canInterruptList(lines, i) {
  const { col, idx } = lineIndent(lines[i]);
  if (col > 3) return false;
  const content = lines[i].slice(idx);
  const m = parseMarker(content, col);
  if (!m) return false;
  const rest = markerRest(content, col, m);
  if (rest.trim() === '') return false;
  if (m.ordered && m.startNum !== 1) return false;
  return true;
}

/** Split a table row line into cells (code-span and escape aware). Returns null if no pipe. */
function splitCells(line) {
  if (!line.includes('|')) return null;
  const cells = [];
  let cur = '';
  let k = 0;
  const n = line.length;
  while (k < n) {
    const c = line[k];
    if (c === '\\' && k + 1 < n) {
      if (line[k + 1] === '|') { cur += '|'; k += 2; continue; }
      cur += line[k] + line[k + 1]; k += 2; continue;
    }
    if (c === '`') {
      let j = k;
      while (j < n && line[j] === '`') j++;
      const run = j - k;
      let close = -1;
      let p = j;
      while (p < n) {
        if (line[p] === '`') {
          let q = p;
          while (q < n && line[q] === '`') q++;
          if (q - p === run) { close = q; break; }
          p = q;
        } else p++;
      }
      if (close === -1) { cur += line.slice(k, j); k = j; continue; }
      // inside a code span, an escaped pipe is still a table escape
      let span = line.slice(k, close);
      let out = '';
      let q = 0;
      while (q < span.length) {
        if (span[q] === '\\' && q + 1 < span.length) {
          if (span[q + 1] === '|') { out += '|'; q += 2; }
          else { out += span[q] + span[q + 1]; q += 2; }
        } else { out += span[q]; q++; }
      }
      cur += out;
      k = close;
      continue;
    }
    if (c === '|') { cells.push(cur); cur = ''; k++; continue; }
    cur += c;
    k++;
  }
  cells.push(cur);
  // drop empty edge cells from leading/trailing pipes
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((s) => s.trim());
}

function tryTable(lines, i, end) {
  if (i + 1 >= end) return null;
  const h = lines[i];
  const d = lines[i + 1];
  const hInd = lineIndent(h);
  const dInd = lineIndent(d);
  if (hInd.col > 3 || dInd.col > 3) return null;
  const hContent = h.slice(hInd.idx);
  const dContent = d.slice(dInd.idx);
  const pipeForm = hContent.startsWith('|') && dContent.startsWith('|');
  const noPipeForm = hContent.includes('|') && dContent.includes('|');
  if (!pipeForm && !noPipeForm) return null;
  const dCells = splitCells(dContent);
  if (!dCells || dCells.length === 0) return null;
  const align = [];
  for (const cell of dCells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    align.push(cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null);
  }
  const header = splitCells(hContent);
  if (!header || header.length === 0) return null;
  const rows = [];
  let j = i + 2;
  while (j < end && !isBlank(lines[j])) {
    const rInd = lineIndent(lines[j]);
    if (rInd.col > 3) break;
    const rContent = lines[j].slice(rInd.idx);
    if (pipeForm && !rContent.startsWith('|')) break;
    if (noPipeForm && !rContent.includes('|')) break;
    const cells = splitCells(rContent);
    if (cells === null) break;
    rows.push(cells);
    j++;
  }
  return { tok: { t: 'table', align, header, rows }, next: j };
}

function parseFenced(lines, i, end, fence, indent = 0) {
  const info = unescapeMd(fence.info);
  const lang = info === '' ? null : info.split(/[ \t]+/)[0];
  const codeLines = [];
  let k = i + 1;
  while (k < end) {
    const line = lines[k];
    const { col, idx } = lineIndent(line);
    const c = line.slice(idx);
    if (col <= 3 && c[0] === fence.char) {
      let j = 0;
      while (j < c.length && c[j] === fence.char) j++;
      if (j >= fence.len && /^[ \t]*$/.test(c.slice(j))) {
        k++;
        return { tok: { t: 'code', text: codeLines.length ? codeLines.join('\n') + '\n' : '', lang }, next: k };
      }
    }
    // content lines lose up to the opening fence's indent
    codeLines.push(indent > 0 ? stripCols(line, indent) : line);
    k++;
  }
  return { tok: { t: 'code', text: codeLines.length ? codeLines.join('\n') + '\n' : '', lang }, next: k };
}

function parseIndentedCode(lines, i, end) {
  const codeLines = [];
  let k = i;
  while (k < end) {
    const line = lines[k];
    if (isBlank(line)) {
      let m = k + 1;
      while (m < end && isBlank(lines[m])) m++;
      if (m < end && lineIndent(lines[m]).col >= 4) { codeLines.push(stripCols(line, 4)); k++; continue; }
      break;
    }
    if (lineIndent(line).col >= 4) { codeLines.push(stripCols(line, 4)); k++; continue; }
    break;
  }
  while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
  return { tok: { t: 'code', text: codeLines.length ? codeLines.join('\n') + '\n' : '', lang: null }, next: k };
}

function parseParagraph(lines, i, end, defs) {
  let j = i;
  for (;;) {
    const d = tryDef(lines, j, end, defs);
    if (d < 0) break;
    j = d;
  }
  if (j >= end || isBlank(lines[j])) return { tok: null, next: j };
  const paraLines = [];
  let k = j;
  while (k < end) {
    const line = lines[k];
    if (isBlank(line)) break;
    const { col, idx } = lineIndent(line);
    const content = line.slice(idx);
    if (col <= 3) {
      if (paraLines.length > 0 && /^(=+|-+)[ \t]*$/.test(content)) {
        const level = content[0] === '=' ? 1 : 2;
        return { tok: { t: 'heading', level, text: paraLines.join('\n').trim() }, next: k + 1 };
      }
      if (matchATX(content) || isFence(content) || isHr(content) ||
          content[0] === '>' || htmlBlockStart(content, true) ||
          canInterruptList(lines, k)) {
        break;
      }
    }
    paraLines.push(line);
    k++;
  }
  if (paraLines.length === 0) return { tok: null, next: k };
  return { tok: { t: 'para', text: paraLines.join('\n') }, next: k };
}

function parseBlockquote(lines, i, end, defs) {
  const sub = [];
  let k = i;
  let prevPara = false;
  let prevLazy = false; // was the previous line added to the paragraph a lazy line?
  let inFence = null; // fence char while inside a fenced code block
  while (k < end) {
    const line = lines[k];
    const { col, idx } = lineIndent(line);
    const content = line.slice(idx);
    if (col <= 3 && content[0] === '>') {
      // strip '>' and one following space; a tab after '>' is expanded to
      // spaces up to the tab stop first, then one space is removed.
      const expanded = expandLeadingTabs(line.slice(idx + 1), col + 1);
      const stripped = expanded.startsWith(' ') ? expanded.slice(1) : expanded;
      sub.push(stripped);
      // track fenced code blocks: lines inside one are not paragraph text,
      // so a lazy line there must not join the quote
      const f = isFence(stripped);
      if (inFence) {
        if (f && f.char === inFence.char && f.len >= inFence.len) inFence = null;
        prevPara = false;
      } else if (f) {
        inFence = f;
        prevPara = false;
      } else {
        prevPara = isParaLike(stripped);
      }
      prevLazy = false;
      k++;
      continue;
    }
    if (isBlank(line)) break;
    if (prevPara && !inFence && isLazyLine(content)) {
      // a lazy setext underline after another lazy line is indented by 4
      // spaces so it stays paragraph text instead of becoming a heading
      if (isSetextLine(content) && prevLazy) sub.push('    ' + line);
      else sub.push(line);
      prevPara = isLazyLine(content);
      prevLazy = true;
      k++;
      continue;
    }
    break;
  }
  const savedTop = HTML_AT_TOP;
  HTML_AT_TOP = false;
  const kids = parseBlocks(sub, 0, sub.length, defs);
  HTML_AT_TOP = savedTop;
  return { tok: { t: 'quote', kids }, next: k };
}

function parseList(lines, i, end, defs) {
  const firstLine = lines[i];
  const { col: baseCol, idx } = lineIndent(firstLine);
  const first = parseMarker(firstLine.slice(idx), baseCol);
  if (!first) return null;
  // a later item joins this list when its marker indent is below the first
  // item's content column; at or above it, it is nested content instead
  const firstContentCol = baseCol + first.contentIndent;
  const items = [];
  let loose = false;
  let k = i;
  let pendingBlank = false;
  while (k < end) {
    const line = lines[k];
    const li = lineIndent(line);
    const m = parseMarker(line.slice(li.idx), li.col);
    if (!m || !sameMarker(m, first) || li.col >= firstContentCol) break;
    if (isHr(line.slice(li.idx))) break;
    if (items.length > 0 && pendingBlank) loose = true;
    pendingBlank = false;
    const itemContentCol = li.col + m.contentIndent;
    const itemLines = [];
    itemLines.push(markerRest(line.slice(li.idx), li.col, m));
    k++;
    let blankRun = false;
    let itemHasBlank = false;
    while (k < end) {
      const l2 = lines[k];
      if (isBlank(l2)) { itemLines.push(''); blankRun = true; k++; continue; }
      const l2i = lineIndent(l2);
      if (l2i.col >= itemContentCol) {
        itemLines.push(stripCols(l2, itemContentCol));
        if (blankRun) { itemHasBlank = true; blankRun = false; }
        k++;
        continue;
      }
      const m2 = parseMarker(l2.slice(l2i.idx), l2i.col);
      if (l2i.col < firstContentCol && isHr(l2.slice(l2i.idx))) break;
      if (m2 && l2i.col < firstContentCol && sameMarker(m2, first)) break;
      const prev = itemLines[itemLines.length - 1];
      if (prev !== '' && isParaLike(prev) && isParaLike(l2.slice(l2i.idx))) {
        itemLines.push(stripCols(l2, itemContentCol));
        if (blankRun) { itemHasBlank = true; blankRun = false; }
        k++;
        continue;
      }
      break;
    }
    if (itemHasBlank) loose = true;
    let trail = 0;
    while (itemLines.length > 0 && itemLines[itemLines.length - 1] === '') { itemLines.pop(); trail++; }
    // a lone empty first line is the item's empty content, not a blank line
    if (trail > 0 && !(trail === 1 && itemLines.length === 0)) pendingBlank = true;
    // task list: first non-blank line starts with [ ] / [x]
    let task = false;
    let checked = false;
    for (let q = 0; q < itemLines.length; q++) {
      if (itemLines[q] === '') continue;
      const tm = /^\[([ xX])\](?:[ \t]|$)/.exec(itemLines[q]);
      if (tm) {
        task = true;
        checked = tm[1] === 'x' || tm[1] === 'X';
        itemLines[q] = itemLines[q].slice(tm[0].length);
      }
      break;
    }
    const savedTop = HTML_AT_TOP;
    HTML_AT_TOP = false;
    const kids = parseBlocks(itemLines, 0, itemLines.length, defs);
    HTML_AT_TOP = savedTop;
    items.push({ task, checked, kids });
  }
  return {
    tok: { t: 'list', ordered: first.ordered, start: first.startNum, loose, items },
    next: k,
  };
}

function parseBlocks(lines, start, end, defs) {
  const toks = [];
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const { col, idx } = lineIndent(line);
    const content = line.slice(idx);
    if (col <= 3) {
      const fence = isFence(content);
      if (fence) {
        const f = parseFenced(lines, i, end, fence, col);
        toks.push(f.tok);
        i = f.next;
        continue;
      }
      const atx = matchATX(content);
      if (atx) { toks.push({ t: 'heading', level: atx.level, text: atx.text }); i++; continue; }
      const hb = htmlBlockStart(content, false);
      if (hb) {
        const h = parseHtmlBlock(lines, i, end, hb);
        toks.push(h.tok);
        i = h.next;
        continue;
      }
      if (isHr(content)) { toks.push({ t: 'hr' }); i++; continue; }
      if (content[0] === '>') {
        const q = parseBlockquote(lines, i, end, defs);
        toks.push(q.tok);
        i = q.next;
        continue;
      }
      if (parseMarker(content, col)) {
        const l = parseList(lines, i, end, defs);
        if (l) { toks.push(l.tok); i = l.next; continue; }
      }
      const table = tryTable(lines, i, end);
      if (table) { toks.push(table.tok); i = table.next; continue; }
      const para = parseParagraph(lines, i, end, defs);
      if (para.tok) toks.push(para.tok);
      i = para.next;
      continue;
    }
    const code = parseIndentedCode(lines, i, end);
    toks.push(code.tok);
    i = code.next;
  }
  return toks;
}

// --------------------------------------------------------------- rendering

function renderListItem(it, loose, defs) {
  let out = '';
  const kids = it.kids;
  for (let n = 0; n < kids.length; n++) {
    const k = kids[n];
    if (k.t === 'para' && !loose) {
      out += inlineHtml(k.text, defs);
    } else {
      out += renderBlocks([k], defs);
    }
  }
  return out;
}

function renderBlocks(toks, defs) {
  let out = '';
  for (const t of toks) {
    if (t.t === 'para') out += '<p>' + inlineHtml(t.text, defs) + '</p>\n';
    else if (t.t === 'heading') out += '<h' + t.level + '>' + inlineHtml(t.text, defs) + '</h' + t.level + '>\n';
    else if (t.t === 'code') {
      out += '<pre><code' + (t.lang ? ' class="language-' + esc(t.lang) + '"' : '') + '>' + escAll(t.text) + '</code></pre>\n';
    }
    else if (t.t === 'hr') out += '<hr>\n';
    else if (t.t === 'html') out += t.text;
    else if (t.t === 'quote') out += '<blockquote>\n' + renderBlocks(t.kids, defs) + '</blockquote>\n';
    else if (t.t === 'list') {
      const tag = t.ordered ? 'ol' : 'ul';
      out += '<' + tag + (t.ordered && t.start !== 1 ? ' start="' + t.start + '"' : '') + '>\n';
      for (const it of t.items) {
        out += '<li>';
        if (it.task) out += '<input ' + (it.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        out += renderListItem(it, t.loose, defs);
        out += '</li>\n';
      }
      out += '</' + tag + '>\n';
    }
    else if (t.t === 'table') {
      out += '<table>\n<thead>\n<tr>\n';
      for (let a = 0; a < t.header.length; a++) {
        const al = t.align[a];
        out += '<th' + (al ? ' align="' + al + '"' : '') + '>' + inlineHtml(t.header[a], defs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n<tbody>';
      for (const row of t.rows) {
        out += '<tr>\n';
        for (let a = 0; a < t.header.length; a++) {
          const al = t.align[a];
          const cell = a < row.length ? row[a] : '';
          out += '<td' + (al ? ' align="' + al + '"' : '') + '>' + inlineHtml(cell, defs) + '</td>\n';
        }
        out += '</tr>\n';
      }
      out += '</tbody></table>\n';
    }
  }
  return out;
}

/** Render markdown to HTML, exactly as marked 18.1.3 does with its defaults. */
export function parse(src) {
  src = src.replace(/\r\n|\r/g, '\n');
  SRC_ENDS_NL = src.endsWith('\n');
  const lines = src.split('\n');
  // a trailing newline produces a final empty element that is not a line
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const defs = new Map();
  HTML_AT_TOP = true;
  const toks = parseBlocks(lines, 0, lines.length, defs);
  HTML_AT_TOP = false;
  return renderBlocks(toks, defs);
}
