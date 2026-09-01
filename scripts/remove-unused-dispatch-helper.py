from pathlib import Path
p = Path('src/pages/DriverDispatch.tsx')
text = p.read_text()
old = '''function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\\b(?:run\\s*)?(\\d{1,3})\\b/i);
  const core = match?.[1] || load.reference;
  return `Run ${core}`;
}
'''
if old in text:
    text = text.replace(old, '', 1)
elif 'function compactRun' in text:
    raise SystemExit('compactRun shape changed unexpectedly')
p.write_text(text)
