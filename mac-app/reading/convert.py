"""Reading version of a PDF for the book-style reader (reader redesign, 25 Nov 2026).

Docling (MIT, https://github.com/docling-project/docling) does the hard part: layout, reading order, which lines are body
text and which are running headers, page numbers or footnotes, and OCR of scanned pages with Apple Vision (ocrmac).
This script only rebuilds the text from Docling's lines so every character keeps the rectangle of its line on the page:
a highlight made in the text becomes a real PDF annotation (main.swift, Reader.markRects), scans included.
No AI: the rules below are code (paragraphs, hyphens, quotes, footnotes, page labels).

Run with Docling's own Python (uv tool install "docling[ocrmac]"):
  python -I convert.py <in.pdf> <out.json>            one file
  python -I convert.py --jobs                          lines "<in.pdf>\t<out.json>" on stdin, one model load for all
Prints one JSON line per file: {"file", "ok", "pages", "secs"} or {"file", "ok": false, "error"}.

Output (version 2, 27 Nov 2026: levels, italics and bold, raised note markers). Coordinates are PDF points from the page's
top left (Docling's page size).
  {v, by, pages, sizes: [[w, h]], labels: {"<pdf page>": "<printed>"}, ocr,
   blocks: [{k, t, r: [{pg, o, ln: [[o, x0, y0, x1, y1]]}], fn?: [[o, len, note]], st?: [[o, len, "i" | "b" | "bi"]], lv?: 1-3}],
   notes: [{m, t, pg}], orig: [pdf pages best read as the original]}
  k: p paragraph, h heading, chap chapter number, q block quote, li list item, fig figure or table (t = caption).
  r: one run per page the block is on; o = where the run starts in t; ln = its lines, o = where the line starts in t.
  st: italic and bold from the font names of the PDF's words (a text layer; scans have none). lv: a heading's level from its
  type size against the body text of its page (1 chapter, 2 section, 3 sub-section).
"""
import json, re, sys, time
from collections import Counter

TERMINAL = re.compile(r'[.!?…:;]["”’»)\]]*[*†‡\d]{0,3}\s*$')
NOTE_START = re.compile(r'^(\*{1,3}|†|‡|§|\d{1,3})(?=[\s.)\]]|[A-Z])')
# Older journal PDFs (MIT Press, Spring 2002) carry a symbol-font text layer that every reader decodes the same wrong way.
GARBLE = re.compile(r'[a-z]Ð[a-z]|®\s?[a-z]{2}|¯\s?[a-z]{2}|ª[A-Za-z]|[a-z.,]º')
GLYPHS = [(re.compile(r'®\s?(?=[a-z])'), 'fi'), (re.compile(r'¯\s?(?=[a-z])'), 'fl'), (re.compile(r'\s?Ð\s?'), '—'),
          (re.compile(r'ª'), '“'), (re.compile(r'º'), '”'), (re.compile(r'(?<=\d)±(?=\d)'), '–')]
APOS = re.compile(r"(?<=\w) ?['’] (?=(s|t|re|ll|ve|d|m)\b)")
ROMAN = re.compile(r'^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$', re.I)


def make_converter():
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, OcrMacOptions
    o = PdfPipelineOptions()
    o.do_ocr = True
    o.ocr_options = OcrMacOptions(lang=["en-US", "de-DE", "es-ES"], replace_broken_text_layer=True)
    o.do_table_structure = False      # tables show as the original page; saves time
    o.generate_parsed_pages = True    # the text lines with their rectangles
    o.generate_page_images = True     # to drop text that is in the file but not on the page (clipped, white on white)
    o.images_scale = 0.5               # enough to tell ink from blank; keeps a 400-page book near 150 MB
    c = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=o)})
    c.initialize_pipeline(InputFormat.PDF)
    return c


def clean(s, garbled):
    if garbled:
        for rx, to in GLYPHS:
            s = rx.sub(to, s)
    s = APOS.sub('’', s)
    # typewriter quotes from scans and old text layers become book quotes (one character for one: offsets stay)
    s = re.sub(r'(^|[\s(\[—–-])"', lambda m: m.group(1) + '“', s)
    s = s.replace('"', '”')
    s = re.sub(r"(^|[\s(\[—–-])'", lambda m: m.group(1) + '‘', s)
    s = s.replace("'", '’')
    return re.sub(r'“ (?=\w)', '“', re.sub(r'(?<=[\w.,!?]) ”', '”', s))


def rows_of(cells, garbled=False):
    """Text lines of a block, top to bottom; cells on the same row joined left to right.
    Small marks (a stray apostrophe or accent the parser gave its own cell) join the row they overlap."""
    big = [c for c in cells if c[2] - c[0] >= 3 or re.search(r'\w', c[4])]
    small = [c for c in cells if c not in big]
    big.sort(key=lambda c: (c[1] + c[3]) / 2)
    rows = []
    for c in big:
        cy, h = (c[1] + c[3]) / 2, c[3] - c[1]
        if rows and abs(cy - rows[-1]['cy']) < max(h, rows[-1]['h']) * 0.5:
            rows[-1]['cells'].append(c)
        else:
            rows.append({'cy': cy, 'h': h, 'cells': [c]})
    for c in small:
        cy = (c[1] + c[3]) / 2
        if rows:
            min(rows, key=lambda r: abs(r['cy'] - cy))['cells'].append(c)
    out = []
    for r in rows:
        cs = sorted(r['cells'], key=lambda c: c[0])
        t = ''
        for c in cs:   # no space before a lone mark that sits against the word before it
            t = t + c[4] if t and not re.search(r'\w', c[4]) and len(c[4]) <= 2 else (t + ' ' + c[4] if t else c[4])
        out.append((clean(t.strip(), garbled), min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs)))
    return [x for x in out if x[0]]


def join_text(t, line):
    """Appends a line; a word hyphenated at the end of the previous line is joined again."""
    if not t:
        return line, 0
    if re.search(r'[A-Za-zÀ-ÿ]-$', t) and re.match(r'[a-zà-ÿ]', line) and not re.match(r'(and|or|und|oder|y|o|to)\b', line):
        return t[:-1] + line, len(t) - 1
    return t + ' ' + line, len(t) + 1


def number_of(s):
    s = re.sub(r'[^0-9A-Za-z]', '', s)
    if s.isdigit() and len(s) <= 4:
        return int(s)
    if s and ROMAN.match(s):
        return s.lower()
    return None


def font_style(name):
    """'ABCDEF+ChaparralPro-SemiboldIt' -> 'bi'; '' when regular. The part after the last '-' or ',' names the style."""
    n = name.split('+')[-1].lower()
    suf = re.split(r'[-,]', n)[-1] if re.search(r'[-,]', n) else n
    it = bool(re.search(r'italic|oblique|slanted|(?:^|[a-z])it$|kursiv', suf))
    bd = bool(re.search(r'bold|semibold|demi|black|heavy|fett', suf))
    return ('b' if bd else '') + ('i' if it else '')


def shape_blocks(blocks, pages, notes, body_h):
    """Version 2: style ranges, raised note markers and heading levels, read line by line from the final blocks."""
    # a book set in italic or bold throughout would make everything a span: then that style says nothing
    allw = [w for P in pages.values() for w in P.get('words', [])]
    share = Counter(c for w in allw for c in w[5])
    off = {c for c in 'ib' if allw and share[c] > 0.5 * len(allw)}
    med = {}
    for pg, P in pages.items():
        hs = sorted(w[3] - w[1] for w in P.get('words', []))
        med[pg] = hs[len(hs) // 2] if hs else 0
    by_m = {}
    for ni, n in enumerate(notes):
        if n.get('m'):
            by_m.setdefault(n['m'], []).append(ni)
    used = {f[2] for b in blocks for f in b.get('fn', [])}
    for b in blocks:
        if b['k'] == 'fig':
            continue
        t = b['t']
        lines = sorted(((l[0], l[1], l[2], l[3], l[4], r['pg']) for r in b['r'] for l in r['ln']), key=lambda x: x[0])
        spans = []
        for li, (o, x0, y0, x1, y1, pg) in enumerate(lines):
            end = lines[li + 1][0] if li + 1 < len(lines) else len(t)
            s = t[o:end]
            ws = sorted((w for w in pages.get(pg, {}).get('words', []) if x0 - 2 <= (w[0] + w[2]) / 2 <= x1 + 2 and y0 - 2 <= (w[1] + w[3]) / 2 <= y1 + 2), key=lambda w: w[0])
            cur = 0
            for w in ws:
                wt = clean(w[4], False)
                i = s.find(wt, cur)
                if i < 0:
                    continue
                cur = i + len(wt)
                st = ''.join(c for c in w[5] if c not in off)
                h = w[3] - w[1]
                raised = med.get(pg) and h < med[pg] * 0.8 and (w[1] + w[3]) / 2 < (y0 + y1) / 2 - 0.1 * (y1 - y0)
                if raised and re.fullmatch(r'\d{1,3}|\*{1,3}|[†‡]', wt):
                    at = o + i
                    if any(f[0] <= at < f[0] + f[1] for f in b.get('fn', [])):
                        continue
                    cand = [ni for ni in by_m.get(wt, []) if ni not in used]
                    same = [ni for ni in cand if notes[ni]['pg'] == pg] or [ni for ni in cand if notes[ni]['pg'] > pg][:1]
                    if same:
                        b.setdefault('fn', []).append([at, len(wt), same[0]])
                        used.add(same[0])
                    continue
                if st:
                    spans.append([o + i, len(wt), st])
        # neighbouring words of one style become one range (the space between them included)
        spans.sort()
        merged = []
        for sp in spans:
            if merged and merged[-1][2] == sp[2] and sp[0] - (merged[-1][0] + merged[-1][1]) <= 1:
                merged[-1][1] = sp[0] + sp[1] - merged[-1][0]
            else:
                merged.append(sp)
        merged = [m for m in merged if m[0] < len(t)]
        for m in merged:
            m[1] = min(m[1], len(t) - m[0])
        # a block in one style throughout (a bold heading, an italic epigraph) keeps it, the reader decides how it looks
        if merged:
            b['st'] = merged
        if b.get('fn'):
            b['fn'].sort()
    # heading levels, within this book: its most common heading size is the section; clearly bigger, or numbered like a
    # chapter ("8. Title", "Chapter 3", "II."), is a chapter; clearly smaller is a sub-section
    hs = [b for b in blocks if b['k'] == 'h' and b['r']]
    ratio = {id(b): b.get('lh', 0) / max(1, body_h(b['r'][0]['pg'])) for b in hs}
    common = Counter(round(r * 20) / 20 for r in ratio.values()).most_common(1)
    sec = common[0][0] if common else 1.2
    CHAP = re.compile(r'^(?:\d{1,2}|[IVXLC]{1,6})\.\s+\S|^(?:chapter|kapitel|cap[ií]tulo|part|teil|parte)\s+\w', re.I)
    for b in hs:
        r = ratio[id(b)]
        b['lv'] = 1 if CHAP.match(b['t']) or r > sec * 1.25 else 3 if r < sec * 0.88 else 2


def convert(conv, src):
    from docling_core.types.doc import ContentLayer, DocItemLabel
    res = conv.convert(src)
    doc = res.document
    pages = {}
    import numpy as np
    hidden = 0
    for p in res.pages:
        n = p.page_no
        cells = []
        ink = None
        try:
            if p.image is not None:
                ink = np.asarray(p.image.convert('L')) < 170
        except Exception:
            ink = None
        sx = ink.shape[1] / p.size.width if ink is not None else 1
        sy = ink.shape[0] / p.size.height if ink is not None else 1
        if p.parsed_page:
            for c in p.parsed_page.textline_cells:
                b = c.rect.to_bounding_box().to_top_left_origin(page_height=p.size.height)
                if not c.text.strip():
                    continue
                if ink is not None and not c.from_ocr and len(c.text.strip()) >= 3:   # stray marks are too thin to test
                    crop = ink[max(0, int(b.t * sy)):int(b.b * sy) + 1, max(0, int(b.l * sx)):int(b.r * sx) + 1]
                    if crop.size == 0 or int(crop.sum()) < 2:   # no ink under it: hidden text (clipped, white on white)
                        hidden += 1
                        continue
                cells.append([b.l, b.t, b.r, b.b, c.text.strip(), c.from_ocr])
        words = []   # word cells with a style or in raised small type: (l, t, r, b, text, style)
        if p.parsed_page:
            for w in (p.parsed_page.word_cells or []):
                if w.from_ocr or not w.text.strip():
                    continue
                b = w.rect.to_bounding_box().to_top_left_origin(page_height=p.size.height)
                words.append((b.l, b.t, b.r, b.b, w.text.strip(), font_style(getattr(w, 'font_name', '') or '')))
        p._image_cache = {} if hasattr(p, '_image_cache') else None
        pages[n] = {'w': p.size.width, 'h': p.size.height, 'cells': cells, 'used': set(), 'words': words}
    npages = max(pages) if pages else 0
    ocr = any(c[5] for pg in pages.values() for c in pg['cells'])
    garbled = len(GARBLE.findall(' '.join(c[4] for pg in pages.values() for c in pg['cells'] if not c[5]))) >= 3

    def is_folio(pg, c):
        """A cell that is only this page's printed number, at the top or bottom: a page number Docling took for text."""
        if off is None or not c[4].strip().isdigit() or int(c[4].strip()) != pg + off:
            return False
        h = pages[pg]['h']
        return c[1] < h * 0.12 or c[3] > h * 0.88

    def in_furniture(pg, cx, cy):
        return any(b[0] - 2 <= cx <= b[2] + 2 and b[1] - 2 <= cy <= b[3] + 2 for b in furn_boxes.get(pg, []))

    def lines_in(pg, bbox_bl):
        """Lines of page pg inside a Docling box (bottom-left origin), each line used once."""
        P = pages.get(pg)
        if not P:
            return []
        l, t, r, b = bbox_bl.l, P['h'] - bbox_bl.t, bbox_bl.r, P['h'] - bbox_bl.b
        got = []
        for i, c in enumerate(P['cells']):
            if i in P['used']:
                continue
            cx, cy = (c[0] + c[2]) / 2, (c[1] + c[3]) / 2
            if l - 2 <= cx <= r + 2 and t - 2 <= cy <= b + 2 and not in_furniture(pg, cx, cy) and not is_folio(pg, c):
                P['used'].add(i)
                got.append(c)
        return rows_of(got, garbled)

    # printed page numbers: the furniture numbers that keep a steady distance to the PDF page
    furn = []
    items = list(doc.iterate_items(with_groups=False, included_content_layers=set(ContentLayer)))
    for it, _ in items:
        if it.label in (DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER) and it.prov:
            n = number_of(getattr(it, 'text', ''))
            if n is not None:
                furn.append((it, it.prov[0].page_no, n))
    offs = Counter(n - pg for _, pg, n in furn if isinstance(n, int))
    off = offs.most_common(1)[0][0] if offs and offs.most_common(1)[0][1] >= 2 else None
    labels, chapter_nums = {}, set()
    for it, pg, n in furn:
        if isinstance(n, int) and off is not None and n - pg == off:
            labels[str(pg)] = str(n)
        elif isinstance(n, str):
            labels.setdefault(str(pg), n)
        elif off is not None and it.label == DocItemLabel.PAGE_HEADER:
            chapter_nums.add(id(it))     # a number at the top that is not the page number: a chapter number
    if off is not None and labels:   # pages without a printed number (chapter openings) follow the same count
        first = min(int(k) for k in labels if labels[k].isdigit()) if any(v.isdigit() for v in labels.values()) else None
        if first:
            for pg in pages:
                if pg >= first and pg + off >= 1:
                    labels.setdefault(str(pg), str(pg + off))

    # body line height per page, to tell footnotes (smaller type) from text
    def body_h(pg):
        hs = sorted(c[3] - c[1] for c in pages.get(pg, {'cells': []})['cells'])
        return hs[len(hs) // 2] if hs else 12

    # furniture boxes (top-left origin), so a footnote's continuation can be told from body text above the page number
    furn_boxes = {}
    for it, _ in items:
        if it.content_layer != ContentLayer.BODY and it.prov:
            for p in it.prov:
                P = pages.get(p.page_no)
                if P:
                    furn_boxes.setdefault(p.page_no, []).append((p.bbox.l, P['h'] - p.bbox.t, p.bbox.r, P['h'] - p.bbox.b))

    def text_below(pg, y):
        """Body lines below y on page pg (page numbers and running heads do not count)."""
        for c in pages.get(pg, {'cells': []})['cells']:
            cx, cy = (c[0] + c[2]) / 2, (c[1] + c[3]) / 2
            if cy > y + 3 and not in_furniture(pg, cx, cy):
                return True
        return False

    blocks, notes, fig_area, text_chars = [], [], Counter(), Counter()
    kind_of = {
        DocItemLabel.SECTION_HEADER: 'h', DocItemLabel.TITLE: 'h', DocItemLabel.LIST_ITEM: 'li',
        DocItemLabel.TEXT: 'p', DocItemLabel.PARAGRAPH: 'p', DocItemLabel.FORMULA: 'p', DocItemLabel.CODE: 'p',
        DocItemLabel.FOOTNOTE: 'fn', DocItemLabel.CAPTION: 'cap',
        DocItemLabel.PICTURE: 'fig', DocItemLabel.TABLE: 'fig', DocItemLabel.CHART: 'fig',
    }
    for it, _ in items:
        if not it.prov:
            continue
        if id(it) in chapter_nums:
            blocks.append({'k': 'chap', 't': re.sub(r'[^0-9A-Za-z]', '', it.text), 'r': [{'pg': it.prov[0].page_no, 'o': 0, 'ln': []}]})
            continue
        if it.content_layer != ContentLayer.BODY:
            continue
        k = kind_of.get(it.label)
        if not k:
            continue
        if k == 'fig':
            for p in it.prov:
                P = pages.get(p.page_no)
                if P:
                    b = p.bbox
                    fig_area[p.page_no] += max(0, (b.r - b.l) * abs(b.t - b.b)) / max(1, P['w'] * P['h'])
            p = it.prov[0]
            P = pages.get(p.page_no, {'h': 0})
            bb = p.bbox
            blocks.append({'k': 'fig', 't': '', 'r': [{'pg': p.page_no, 'o': 0, 'ln': [[0, bb.l, P['h'] - bb.t, bb.r, P['h'] - bb.b]]}]})
            continue
        text, runs = '', []
        for p in it.prov:
            rows = lines_in(p.page_no, p.bbox)
            if not rows:   # no line found: Docling's own text for this part
                P = pages.get(p.page_no, {'h': 0})
                part = it.text[p.charspan[0]:p.charspan[1]] if p.charspan else it.text
                if off is not None and part.strip().isdigit() and int(part.strip()) == p.page_no + off:
                    continue   # the page number, taken for text
                if any(c[5] is False for c in P.get('cells', [])) and not any(
                        p.bbox.l - 2 <= (c[0] + c[2]) / 2 <= p.bbox.r + 2 and P['h'] - p.bbox.t - 2 <= (c[1] + c[3]) / 2 <= P['h'] - p.bbox.b + 2
                        for c in P.get('cells', [])):
                    continue   # a text page, and nothing visible there: hidden text
                rows = [(part.strip(), p.bbox.l, P['h'] - p.bbox.t, p.bbox.r, P['h'] - p.bbox.b)] if part.strip() else []
            run = {'pg': p.page_no, 'o': None, 'ln': []}
            for (s, x0, y0, x1, y1) in rows:
                text, at = join_text(text, s)
                if run['o'] is None:
                    run['o'] = at
                run['ln'].append([at, round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)])
            if run['ln']:
                runs.append(run)
                text_chars[p.page_no] += sum(len(r[0]) for r in rows)
        if not text.strip():
            continue
        pg = runs[0]['pg']
        lh = sum(l[4] - l[2] for l in runs[0]['ln']) / len(runs[0]['ln'])
        y_top = runs[0]['ln'][0][2]
        # a footnote: Docling says so, or a marked block in smaller type in the lower part of the page
        if k == 'fn' or (k == 'p' and NOTE_START.match(text) and lh < body_h(pg) * 0.93 and y_top > pages[pg]['h'] * 0.45):
            m = NOTE_START.match(text)
            notes.append({'m': m.group(1) if m else '', 't': text[m.end():].strip() if m else text, 'pg': pg})
            continue
        if k == 'cap':
            if blocks and blocks[-1]['k'] == 'fig' and not blocks[-1]['t']:
                blocks[-1]['t'] = text
                continue
            k = 'p'
        # an unmarked block in small type at the very top of the lower part after a page that ended with a note: its continuation
        y_end = runs[-1]['ln'][-1][4]
        if k == 'p' and notes and notes[-1]['pg'] == pg - 1 and lh < body_h(pg) * 0.93 and y_top > pages[pg]['h'] * 0.45 and not NOTE_START.match(text) and not text_below(pg, y_end):
            notes[-1]['t'] = join_text(notes[-1]['t'], text)[0]
            continue
        blocks.append({'k': k, 't': text, 'r': runs, 'lh': lh})

    # block quotes: indented on both sides against the page's body lines (single-column pages only)
    def body_edges(pg):
        xs = sorted(l[1] for b in blocks for r in b['r'] if r['pg'] == pg for l in r['ln'])
        xe = sorted(l[3] for b in blocks for r in b['r'] if r['pg'] == pg for l in r['ln'])
        if len(xs) < 6:
            return None
        w = pages[pg]['w']
        narrow = sum(1 for b in blocks for r in b['r'] if r['pg'] == pg for l in r['ln'] if l[3] - l[1] < w * 0.5)
        if narrow > len(xs) * 0.5:
            return None   # two columns
        return xs[len(xs) // 10], xe[len(xe) * 9 // 10]
    edges = {pg: body_edges(pg) for pg in pages}
    # Running heads Docling took for text ("8 Book Title", "Introduction: Chapter Title 7"): one line at the top or
    # bottom of the page whose words, numbers left out, come back on at least 3 pages. Their number is the printed page.
    def edge_line(b):
        if len(b['r']) != 1 or len(b['r'][0]['ln']) != 1 or b['k'] not in ('p', 'h'):
            return None
        pg, l = b['r'][0]['pg'], b['r'][0]['ln'][0]
        cs = pages[pg]['cells']
        if not cs:
            return None
        top, bottom, lh = min(c[1] for c in cs), max(c[3] for c in cs), l[4] - l[2]
        return pg if (l[2] <= top + lh * 1.5 or l[4] >= bottom - lh * 1.5) else None
    heads = Counter()
    for b in blocks:
        if edge_line(b) and len(b['t']) < 90:
            heads[re.sub(r'[\divxlcdm]+\b|\W', '', b['t'].lower())] += 1
    kept = []
    for b in blocks:
        pg = edge_line(b)
        key = re.sub(r'[\divxlcdm]+\b|\W', '', b['t'].lower()) if pg else None
        if pg and (heads[key] >= 3 or (off is not None and b['t'].strip().isdigit() and int(b['t']) == pg + off)):
            m = re.search(r'(?:^|\s)(\d{1,4})(?:\s|$)', b['t'])
            if m:
                labels.setdefault(str(pg), m.group(1))
            continue
        kept.append(b)
    # then any edge line that starts or ends with the printed number the page should have
    offs2 = Counter(int(v) - int(k) for k, v in labels.items() if v.isdigit())
    off2 = offs2.most_common(1)[0][0] if offs2 and offs2.most_common(1)[0][1] >= 3 else None
    blocks = []
    for b in kept:
        pg = edge_line(b)
        m = re.match(r'^(\d{1,4})\s+\S|.*\S\s+(\d{1,4})$', b['t'].strip()) if pg else None
        if m and off2 is not None and int(m.group(1) or m.group(2)) == pg + off2:
            labels.setdefault(str(pg), m.group(1) or m.group(2))
            continue
        blocks.append(b)

    # Block quotes. Lines of a page are grouped where the line spacing jumps (quotes are set off by space), not at Docling
    # block boundaries (it cuts quotes into lines); a group is a quote when all its lines sit clearly right of the body lines in the groups next to it.
    # Neighbours, not the page edge, because scans are often a little tilted.
    qf = {}   # (block index, line index in block) -> quote line
    for pg in pages:
        if not edges.get(pg):
            continue
        ln = []
        for bi, b in enumerate(blocks):
            if b['k'] != 'p':
                continue
            li = 0
            for r in b['r']:
                for l in r['ln']:
                    if r['pg'] == pg:
                        ln.append((bi, li, l))
                    li += 1
        if len(ln) < 3:
            continue
        pitches = sorted(y[2][2] - x[2][2] for x, y in zip(ln, ln[1:]) if y[2][2] > x[2][2])
        pitch = pitches[len(pitches) // 2] if pitches else 14
        groups, cur = [], [ln[0]]
        for prev, x in zip(ln, ln[1:]):
            if x[2][2] - prev[2][2] > pitch * 1.35 or x[2][2] < prev[2][2]:
                groups.append(cur)
                cur = []
            cur.append(x)
        groups.append(cur)
        w = pages[pg]['w']
        for gi, g in enumerate(groups):
            em = blocks[g[0][0]].get('lh', 12)
            near = [x[2][1] for gj in (gi - 1, gi + 1) if 0 <= gj < len(groups) for x in (groups[gj][1:] or groups[gj])]
            ref = min(near) if near else edges[pg][0]
            need = max(0.6 * em, 0.028 * w) if len(g) > 1 else max(1.6 * em, 0.06 * w)
            if all(x[2][1] - ref > need for x in g):
                for x in g:
                    qf[(x[0], x[1])] = True

    def split_quotes(bi, b):
        """A block that goes from body text to a quote (or back) becomes two blocks there."""
        if b['k'] != 'p':
            return [b]
        ln = [l + [r['pg']] for r in b['r'] for l in r['ln']]
        flags = [qf.get((bi, i), False) for i in range(len(ln))]
        if not any(flags):
            return [b]
        if all(flags):
            b['k'] = 'q'
            return [b]
        out, i = [], 0
        while i < len(ln):
            j = i
            while j < len(ln) and flags[j] == flags[i]:
                j += 1
            s0 = ln[i][0]
            s1 = ln[j][0] if j < len(ln) else len(b['t'])
            t = b['t'][s0:s1].rstrip()
            runs = []
            for l in ln[i:j]:
                nl = [l[0] - s0] + l[1:5]
                if runs and runs[-1]['pg'] == l[5]:
                    runs[-1]['ln'].append(nl)
                else:
                    runs.append({'pg': l[5], 'o': nl[0], 'ln': [nl]})
            out.append({'k': 'q' if flags[i] else 'p', 't': t, 'r': runs, 'lh': b['lh']})
            i = j
        return out
    blocks = [x for bi, b in enumerate(blocks) for x in split_quotes(bi, b)]

    # paragraphs Docling cut in two: the first does not end a sentence, so the next one continues it
    merged = []
    for b in blocks:
        a = merged[-1] if merged else None
        if a and a['k'] == b['k'] and b['k'] in ('p', 'q') and not TERMINAL.search(a['t']):
            t, at = join_text(a['t'], b['t'])
            shift = at
            for r in b['r']:
                r['o'] += shift
                for l in r['ln']:
                    l[0] += shift
                if a['r'] and a['r'][-1]['pg'] == r['pg']:
                    a['r'][-1]['ln'] += r['ln']
                else:
                    a['r'].append(r)
            a['t'] = t
            continue
        merged.append(b)
    blocks = merged

    # footnote markers in the text: the first matching marker on the note's page (or the page before)
    for ni, n in enumerate(notes):
        m = n['m']
        if not m:
            continue
        pat = re.compile(re.escape(m) if not m.isdigit() else r'(?<=[A-Za-zÀ-ÿ.,;:’”")\]])' + m + r'(?![0-9])')
        found = False
        for pg in (n['pg'], n['pg'] - 1):
            for b in blocks:
                if b['k'] not in ('p', 'q', 'li', 'h') or not any(r['pg'] == pg for r in b['r']):
                    continue
                for x in pat.finditer(b['t']):
                    if x.start() == 0:
                        continue
                    if any(f[0] == x.start() for f in b.get('fn', [])):
                        continue
                    b.setdefault('fn', []).append([x.start(), len(m), ni])
                    found = True
                    break
                if found:
                    break
            if found:
                break

    shape_blocks(blocks, pages, notes, body_h)
    for b in blocks:
        b.pop('lh', None)
    # pages best read as the original: mostly figures, or nothing read from them
    orig = sorted(pg for pg in pages if fig_area[pg] > 0.45 and text_chars[pg] < 600 or (text_chars[pg] < 40 and pages[pg]['cells'] == []))
    import importlib.metadata as md
    return {
        'v': 2, 'by': 'docling ' + md.version('docling'), 'pages': npages,
        'sizes': [[round(pages[i]['w'], 1), round(pages[i]['h'], 1)] if i in pages else [0, 0] for i in range(1, npages + 1)],
        'labels': labels, 'ocr': ocr, 'fixed': garbled, 'hidden': hidden, 'blocks': blocks, 'notes': notes, 'orig': orig,
    }


def run(conv, src, dst):
    t = time.time()
    try:
        out = convert(conv, src)
        tmp = dst + '.part'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        import os
        os.replace(tmp, dst)
        print(json.dumps({'file': src, 'ok': True, 'pages': out['pages'], 'secs': round(time.time() - t, 1)}), flush=True)
    except Exception as e:
        print(json.dumps({'file': src, 'ok': False, 'error': str(e)[:300]}), flush=True)


if __name__ == '__main__':
    import logging, warnings
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    conv = make_converter()
    print(json.dumps({'ready': True}), flush=True)
    if sys.argv[1:2] == ['--jobs']:
        for line in sys.stdin:
            parts = line.rstrip('\n').split('\t')
            if len(parts) == 2:
                run(conv, parts[0], parts[1])
    else:
        run(conv, sys.argv[1], sys.argv[2])
