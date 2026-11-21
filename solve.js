// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly what csv-reader 1.0.0 returns for the same input:
// {columns, rows, errors} for {text, header}, following its written broken-row
// policy (BOM dropped, CRLF/LF record ends, stray CRs dropped with an error,
// quoted fields with "" escapes and LF-normalised line breaks inside, junk
// after a closing quote appended, unterminated quotes re-read as unquoted,
// short/long rows padded or cut to the first record's width).
//
// The reference builds every field one character at a time. This version
// reads the same text once, left to right, but finds each field's end with
// indexOf and takes the field out with one slice, so the common case (a
// plain field, a quoted field with no doubled quotes) costs a couple of
// native scans instead of a string append per character. Anything unusual
// (a stray CR, a line break inside quotes) falls back to a small loop over
// just that field or segment. Field results travel back through two shared
// variables instead of a fresh object per field, so the hot path allocates
// almost nothing per field. Pure: no state kept between calls.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters the unquoted read kept onto it.
  // The readers return the field's value and report these two through shared variables,
  // so no fresh object is allocated per field.
  let fieldEnded = END;
  let fieldAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field; fieldEnded says how it ended and fieldAdded counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    const p = pos;
    const cIdx = text.indexOf(',', p);
    const nIdx = text.indexOf('\n', p);
    let m;
    let ended;
    if (cIdx === -1) {
      if (nIdx === -1) {
        m = len;
        ended = END;
      } else {
        m = nIdx;
        ended = LINE_BREAK;
      }
    } else if (nIdx === -1 || cIdx < nIdx) {
      m = cIdx;
      ended = COMMA;
    } else {
      m = nIdx;
      ended = LINE_BREAK;
    }
    // A CR just before the line break is the CRLF's first half, not part of the field.
    let end = m;
    if (ended === LINE_BREAK && m > p && text.charCodeAt(m - 1) === 13) end = m - 1;
    const field = text.slice(p, end);
    if (field.indexOf('\r') === -1) {
      if (value === '') value = field;
      else value += field;
      added += field.length;
    } else {
      // Every CR left in the field is stray: drop it, with an error each.
      let out = '';
      let start = 0;
      for (let i = 0; i < field.length; i++) {
        if (field.charCodeAt(i) === 13) {
          error('stray_cr');
          out += field.slice(start, i);
          start = i + 1;
        }
      }
      out += field.slice(start);
      if (value === '') value = out;
      else value += out;
      added += out.length;
    }
    if (ended === COMMA) {
      pos = m + 1;
    } else if (ended === LINE_BREAK) {
      pos = m + 1;
      line += 1;
    } else {
      pos = m;
    }
    fieldEnded = ended;
    fieldAdded = added;
    return value;
  }

  // The segment text[p..q) of a quoted field: CRs and CRLFs inside it each read as one LF, and every line break
  // inside it counts a line. A segment with no line break in it is returned as it stands.
  function convertSegment(p, q) {
    const seg = text.slice(p, q);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) return seg;
    let n = 0;
    for (let i = 0; i < seg.length; i++) {
      const cc = seg.charCodeAt(i);
      if (cc === 10) {
        n += 1;
      } else if (cc === 13) {
        n += 1;
        if (seg.charCodeAt(i + 1) === 10) i += 1;
      }
    }
    line += n;
    return seg.indexOf('\r') === -1 ? seg : seg.replace(/\r\n?/g, '\n');
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field; fieldEnded says how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    while (true) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field; the field goes on.
        value += convertSegment(p, q);
        value += '"';
        p = q + 2;
        continue;
      }
      value += convertSegment(p, q);
      pos = q + 1;
      if (pos >= len) {
        fieldEnded = END;
        fieldAdded = 0;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fieldEnded = COMMA;
        fieldAdded = 0;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fieldEnded = LINE_BREAK;
        fieldAdded = 0;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fieldEnded = LINE_BREAK;
        fieldAdded = 0;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (fieldAdded > 0) error('quote_junk');
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (fieldEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
