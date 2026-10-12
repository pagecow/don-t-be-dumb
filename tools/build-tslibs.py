import json, os, glob

libdir = 'libs/lib'
files = {}
for p in sorted(glob.glob(os.path.join(libdir, '*.d.ts'))):
    name = os.path.basename(p)
    with open(p, 'r', encoding='utf-8') as fh:
        files[name] = fh.read()

payload = json.dumps(files, separators=(',', ':')).replace('</', '<\\/')
with open('libs/tslibs.js', 'w', encoding='utf-8') as fh:
    fh.write('window.__DBD_TS_LIBS__ = ' + payload + ';\n')
    fh.write('window.__DBD_TS_LIBS_INFO__ = { count: %d, source: "typescript-5.6.3" };\n' % len(files))
print('tslibs.js written:', os.path.getsize('libs/tslibs.js'), 'bytes,', len(files), 'lib files')
