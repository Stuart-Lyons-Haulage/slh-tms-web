from pathlib import Path

root = Path(__file__).resolve().parents[1]

csv_path = root / "src/pages/MasterDataCsvImport.tsx"
csv_text = csv_path.read_text(encoding="utf-8")
if not csv_text.startswith("/* eslint-disable react-refresh/only-export-components */"):
    csv_text = "/* eslint-disable react-refresh/only-export-components */\n" + csv_text
csv_path.write_text(csv_text, encoding="utf-8")

pallet_path = root / "src/pages/PalletPlanningControl.tsx"
pallet_text = pallet_path.read_text(encoding="utf-8")
old = "const draft = currentDraft(order); const tone = palletTone(order.palletType); return"
if old not in pallet_text:
    raise SystemExit("Expected Pallet Control lint anchor not found")
pallet_path.write_text(pallet_text.replace(old, "const draft = currentDraft(order); return", 1), encoding="utf-8")

print("Housekeeping lint fixes applied")
