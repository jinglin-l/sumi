#!/usr/bin/env python3
"""Inject the Quartz-style shell into explainer pages.

  build.py --preview a b c   copy pages a.html b.html c.html into quartz-preview/ with the shell
  build.py --all             inject the shell into every page in place (idempotent)
  build.py --strip           remove the shell from every page (undo --all)

Each command acts on the pages folder: the current directory, or the one given with
--dir PATH (e.g. build.py --all --dir ~/visual-explainers).

The shell is quartz.css + quartz.js + quartz-data.js (a generated manifest of every page,
built from index.html cards + each page's <title>/headings/links, plus the doodles/ SVGs).
"""
import datetime, glob, html, json, os, re, shutil, sys

# The template (theme, fonts, doodles) is wherever this file lives.
HERE = os.path.dirname(os.path.abspath(__file__))


def pages_root(args):
    # The pages folder is separate from the template: the repo lives at e.g. ~/sumi and the
    # pages at ~/visual-explainers, outside git. An earlier version assumed the template was
    # cloned *inside* the pages folder and used its parent, which tied the repo's location
    # to the pages. Taking the folder as an argument (default: cwd) decouples the two.
    root = os.getcwd()
    if '--dir' in args:
        i = args.index('--dir')
        root = os.path.expanduser(args[i + 1])
        del args[i:i + 2]
    root = os.path.abspath(root)
    # --all rewrites every *.html in root, so running it from the wrong directory would
    # inject the shell into unrelated files. index.html is the marker of a pages folder.
    if not os.path.isfile(os.path.join(root, 'index.html')):
        sys.exit(f'no index.html in {root}: run from your pages folder or pass --dir PATH')
    return root


ARGS = sys.argv[1:]
ROOT = pages_root(ARGS) if ARGS[:1] in (['--preview'], ['--all'], ['--strip']) else None
MARK = re.compile(r'<!-- quartz:begin -->.*?<!-- quartz:end -->\n?', re.S)


def text(s):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', s)).split())


def manifest():
    idx = open(os.path.join(ROOT, 'index.html')).read()
    cards = {}
    for m in re.finditer(r'<a class="card" href="([^"]+)" data-tags="([^"]*)">(.*?)</a>', idx, re.S):
        b = m.group(3)
        g = lambda pat: (lambda r: text(r.group(1)) if r else '')(re.search(pat, b, re.S))
        cards[m.group(1)] = dict(title=g(r'card-title">(.*?)</div>'), blurb=g(r'card-blurb">(.*?)</p>'),
                                 tag=g(r'class="tag">(.*?)</span>'), tags=m.group(2).split())
    files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(ROOT, '*.html')))
    files = [f for f in files if f != 'index.html']
    pages = []
    for f in files:
        s = MARK.sub('', open(os.path.join(ROOT, f)).read())
        c = cards.get(f, {})
        t = re.search(r'<title>(.*?)</title>', s, re.S)
        body = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s, flags=re.S)
        links = sorted({l for l in re.findall(r'href="([\w.-]+\.html)', s) if l in files and l != f})
        pages.append(dict(
            file=f,
            title=c.get('title') or (text(t.group(1)) if t else f),
            blurb=c.get('blurb', ''),
            tag=c.get('tag') or 'Uncategorized',
            tags=c.get('tags', []),
            headings=[text(h) for h in re.findall(r'<h[23][^>]*>(.*?)</h[23]>', s, re.S)][:30],
            links=links,
            words=len(text(body).split()),
            date=datetime.date.fromtimestamp(os.path.getmtime(os.path.join(ROOT, f))).isoformat(),
            # Full-precision edit time (epoch seconds) for the index's "most recent first" sort.
            # `date` alone is day-granular, so several pages edited the same day would tie.
            # A page opened over file:// can't stat files itself, so the time has to be baked
            # in here; it stays accurate because inject() restores each page's mtime.
            mtime=int(os.path.getmtime(os.path.join(ROOT, f))),
        ))
    return pages


def inject(s, prefix):
    s = MARK.sub('', s)
    head = f'<!-- quartz:begin --><link rel="stylesheet" href="{prefix}quartz.css"><!-- quartz:end -->\n'
    # quartz-local.js is an optional per-folder add-on (not part of the template), e.g. machine-only controls that
    # must never ship with a published copy. It loads only when the file exists in the pages folder, so folders
    # without one get no 404 in the console. Loaded after quartz.js so it can use the finished shell DOM.
    local = (f'<script src="{prefix}quartz-local.js"></script>'
             if ROOT and os.path.exists(os.path.join(ROOT, 'quartz-local.js')) else '')
    tail = (f'<!-- quartz:begin --><script src="{prefix}quartz-data.js"></script>'
            f'<script src="{prefix}quartz.js"></script>{local}<!-- quartz:end -->\n')
    s = s.replace('</head>', head + '</head>', 1) if '</head>' in s else head + s
    i = s.rfind('</body>')
    return s[:i] + tail + s[i:] if i >= 0 else s + tail


def write_assets(dest, pages, href, home):
    for f in ('quartz.css', 'quartz.js'):
        shutil.copy(os.path.join(HERE, f), os.path.join(dest, f))
    fonts = os.path.join(dest, 'fonts')
    os.makedirs(fonts, exist_ok=True)
    for f in set(re.findall(r'url\(fonts/([^)]+)\)', open(os.path.join(HERE, 'quartz.css')).read())):
        shutil.copy(os.path.join(HERE, 'fonts', f), fonts)
    for p in pages:
        p['href'] = href(p['file'])
    # Margin doodles (hand-drawn SVGs): inlined into the manifest
    # because pages open from file://, where quartz.js can't fetch the .svg files.
    order = json.load(open(os.path.join(HERE, 'doodles', 'doodles.json')))
    doodles = [dict(rot=d['rot'], svg=open(os.path.join(HERE, 'doodles', d['name'] + '.svg')).read().strip()) for d in order]
    # Site name = the index page's <h1>, so each pages folder names itself
    # (renaming the site is a one-line edit to index.html, not a template change).
    # Falls back to the template's default if the index has no <h1>.
    m = re.search(r'<h1[^>]*>(.*?)</h1>', open(os.path.join(ROOT, 'index.html')).read(), re.S)
    site = text(m.group(1)) if m else 'Visual Explainers'
    data = dict(site=site, home=home, pages=pages, doodles=doodles)
    with open(os.path.join(dest, 'quartz-data.js'), 'w') as fh:
        fh.write('window.QUARTZ = ' + json.dumps(data, ensure_ascii=False) + ';\n')


def main():
    args = ARGS  # already stripped of --dir by pages_root()
    if ROOT is None:
        print(__doc__)
        return
    pages = manifest()
    if args[:1] == ['--preview']:
        names = [a.removesuffix('.html') + '.html' for a in args[1:]]
        dest = os.path.join(ROOT, 'quartz-preview')
        os.makedirs(dest, exist_ok=True)
        for n in names:
            s = open(os.path.join(ROOT, n)).read()
            open(os.path.join(dest, n), 'w').write(inject(s, ''))
        write_assets(dest, pages, lambda f: f if f in names else '../' + f, '../index.html')
        print('preview:', ', '.join(os.path.join(dest, n) for n in names))
    elif args[:1] == ['--all']:
        for f in [p['file'] for p in pages] + ['index.html']:
            path = os.path.join(ROOT, f)
            st = os.stat(path)
            with open(path) as fh:  # read fully before opening for write — 'w' truncates
                s = fh.read()
            if len(s) < 2000:  # an emptied file — never write over it
                print('SKIP (looks truncated):', f)
                continue
            with open(path, 'w') as fh:
                fh.write(inject(s, ''))
            os.utime(path, (st.st_atime, st.st_mtime))  # the "date" line reads mtime; keep it
        write_assets(ROOT, pages, lambda f: f, 'index.html')
        print(f'injected {len(pages)} pages + index.html')
    elif args[:1] == ['--strip']:
        for f in [p['file'] for p in pages] + ['index.html']:
            path = os.path.join(ROOT, f)
            st = os.stat(path)
            with open(path) as fh:
                s = fh.read()
            with open(path, 'w') as fh:
                fh.write(MARK.sub('', s))
            os.utime(path, (st.st_atime, st.st_mtime))
        print('stripped')
    else:
        print(__doc__)


main()
