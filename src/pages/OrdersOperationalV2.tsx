import { useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { api, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../orders-operational.css";

type ImportOrder = {
  rowIndex: number;
  poNumber: string;
  customerCode: string;
  collectionDate: string;
  deliveryDate: string;
  pallets: string;
  sellerName: string;
  marketName: string;
  stallNumber: string;
  driverInstructions: string;
  mapLink: string;
  deliveryAddress: string;
  customerRef: string;
  palletName: string;
  poRef: string;
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function normaliseHeader(value: unknown) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function first(row: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = row[normaliseHeader(name)];
    if (clean(value)) return clean(value);
  }
  return "";
}
function dateValue(value: string) {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const uk = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (uk) {
    const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${year}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }
  return "";
}
function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) { row.push(field.trim()); field = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])])));
}
function mapRow(row: Record<string, string>, index: number): ImportOrder | undefined {
  const requestedDate = dateValue(first(row, "Requested Ship Date", "Collection Date", "Date"));
  const collectionSite = first(row, "04. Collection Site", "Collection Site", "Collection", "Origin");
  const customer = first(row, "Customer Name", "Customer", "Customer Code", "Account");
  const depotId = first(row, "DepotID", "Depot ID", "Delivery Depot", "Destination Code");
  const depotDescription = first(row, "Depot Description", "Destination", "Delivery Location", "Consignee");
  const deliveryAddress = first(row, "Delivery Address", "Address", "Postcode", "Delivery Postcode");
  const salesOrder = first(row, "Sales Order ID", "Sales Order", "Order Number", "Order Ref");
  const customerRef = first(row, "CustomerRef", "Customer Ref", "Customer Reference");
  const palletName = first(row, "Pallet Name", "Pallet Type", "Goods", "Product");
  const pallets = first(row, "PalletQty", "Pallet Qty", "Pallets", "Quantity", "Qty") || "1";
  const poRef = first(row, "PO REF", "PO Ref", "PO", "Purchase Order");
  const reference = salesOrder || poRef || customerRef || `ORDER-${index + 1}`;
  if (!requestedDate || !customer) return undefined;
  const notes = [
    collectionSite ? `Collection site: ${collectionSite}` : "",
    depotId ? `Depot ID: ${depotId}` : "",
    depotDescription ? `Depot: ${depotDescription}` : "",
    deliveryAddress ? `Delivery address: ${deliveryAddress}` : "",
    customerRef ? `Customer ref: ${customerRef}` : "",
    poRef ? `PO ref: ${poRef}` : "",
    palletName ? `Pallet: ${palletName}` : "",
  ].filter(Boolean).join(" · ");
  return {
    rowIndex: index,
    poNumber: reference,
    customerCode: customer,
    collectionDate: requestedDate,
    deliveryDate: requestedDate,
    pallets,
    sellerName: collectionSite,
    marketName: depotId,
    stallNumber: depotDescription,
    driverInstructions: notes,
    mapLink: deliveryAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress)}` : "",
    deliveryAddress,
    customerRef,
    palletName,
    poRef,
  };
}

export function OrdersOperationalV2() {
  const token = useAccessToken();
  const [rows, setRows] = useState<ImportOrder[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setMessage(undefined);
    const parsed = parseCsvRows(await file.text());
    const mapped = parsed.flatMap((row, index) => {
      const item = mapRow(row, index);
      return item ? [item] : [];
    });
    setRows(mapped);
    setMessage(mapped.length ? `${mapped.length} jobs recognised and ready to send to Order Review.` : "No valid orders were recognised.");
  }

  async function submitRows() {
    if (!rows.length || submitting) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const records: StageBatchRequest[] = rows.map((row) => ({
        entityType: "order",
        // V2 key includes the source row and delivery identity. This prevents separate
        // lines sharing one Sales Order ID from collapsing into a single staged item,
        // while still deduplicating a repeated import of the same file layout.
        idempotencyKey: `structured-csv-v2:${row.collectionDate}:${row.poNumber}:${row.marketName}:${row.customerRef}:${row.palletName}:${row.rowIndex}`.slice(0, 200),
        source: `Customer CSV · ${fileName || "upload"}`,
        payload: {
          poNumber: row.poNumber,
          customerCode: row.customerCode,
          collectionDate: row.collectionDate,
          deliveryDate: row.deliveryDate,
          pallets: row.pallets,
          sellerName: row.sellerName,
          marketName: row.marketName,
          stallNumber: row.stallNumber,
          driverInstructions: row.driverInstructions,
          mapLink: row.mapLink,
        },
      }));
      const accessToken = await token();
      const result = await api.stageBatch(records, accessToken);
      const pending = result.records.filter((item) => String(item.status).toLowerCase() === "pendingreview" || String(item.status) === "0").length;
      setMessage(`${result.received} submitted. ${result.created} new Order Review item${result.created === 1 ? "" : "s"}; ${result.existing} already existed. ${pending} currently pending review.`);
      setRows([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order staging failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="orders-operational">
    <div className="title-row">
      <div><p className="eyebrow">Order intake</p><h1>Customer orders</h1><p className="intro">Import the customer file, preserve every delivery line, then submit it into Order Review for approval.</p></div>
      <Link className="button-like" to="/staging">Open Order Review</Link>
    </div>
    <article className="panel structured-import">
      <p className="eyebrow">Customer file</p><h2>Import CSV</h2>
      <p>Recognises Requested Ship Date, Collection Site, Customer, Depot, Delivery Address, Sales Order, Customer Ref, Pallets and PO Ref.</p>
      <label className="file-drop"><strong>Choose customer CSV</strong><span>{fileName || "CSV files with quoted addresses are supported"}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event)} /></label>
      {rows.length > 0 && <button className="primary" disabled={submitting} onClick={() => void submitRows()}>{submitting ? "Submitting…" : `Send ${rows.length} to Order Review`}</button>}
    </article>
    {message && <p className="notice inline-notice">{message}</p>}
    {rows.length > 0 && <div className="structured-preview"><div className="preview-heading"><h2>Import preview</h2><span>{rows.length} jobs</span></div><div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Collection</th><th>Depot</th><th>Destination</th><th>Address</th><th>Pallets</th><th>Customer ref</th></tr></thead><tbody>{rows.slice(0, 250).map((row) => <tr key={`${row.rowIndex}-${row.poNumber}`}><td><strong>{row.poNumber}</strong></td><td>{row.customerCode}</td><td>{row.sellerName || "—"}</td><td>{row.marketName || "—"}</td><td>{row.stallNumber || "—"}</td><td>{row.deliveryAddress || "—"}</td><td>{row.pallets}</td><td>{row.customerRef || "—"}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
