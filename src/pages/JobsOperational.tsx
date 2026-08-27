import { useCallback, useMemo, useState } from "react";
import { GeofenceStatusBadge, SiteCoverageWarningPanel, useSiteGeofenceCoverage } from "../components/GeofenceCoverageWarnings";
import { api, request, type TransportOrder } from "../lib/api";
import { orderMaintenance, type OrderUpdatePayload } from "../lib/orderMaintenance";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tagged(notes: string | undefined, label: string) {
  if (!notes) return "";
  const prefix = `${label}:`;
  return notes.split("·").map((part) => part.trim()).find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || "";
}

function editable(order: TransportOrder): OrderUpdatePayload {
  return {
    reference: order.reference,
    customerCode: order.customerCode,
    collectionDate: order.collectionDate,
    deliveryDate: order.deliveryDate || order.collectionDate,
    pallets: order.pallets,
    collectionSite: order.sellerName || tagged(order.driverInstructions, "Collection site"),
    depotId: order.marketName || tagged(order.driverInstructions, "Depot ID"),
    destination: order.stallNumber || tagged(order.driverInstructions, "Depot"),
    deliveryAddress: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
    poRef: tagged(order.driverInstructions, "PO ref"),
    palletName: tagged(order.driverInstructions, "Pallet"),
    unitType: tagged(order.driverInstructions, "Unit type") || tagged(order.driverInstructions, "Capacity type") || "Pallets",
    notes: "",
    mapLink: order.mapLink,
  };
}

export function JobsOperational() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<OrderUpdatePayload>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const orders = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));

  const rows = useMemo(() => (orders.data || []).filter((order) => {
    if (order.status === "Cancelled") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [order.reference, order.customerCode, order.sellerName, order.marketName, order.stallNumber, order.driverInstructions]
      .some((value) => String(value || "").toLowerCase().includes(q));
  }), [orders.data, query]);

  const siteLabels = useMemo(() => Array.from(new Set(rows.flatMap(order => [order.sellerName, order.marketName, order.stallNumber]).map(value => String(value || "").trim()).filter(Boolean))), [rows]);
  const geofenceCoverage = useSiteGeofenceCoverage(siteLabels);

  function begin(order: TransportOrder) {
    setEditingId(order.id);
    setForm(editable(order));
    setMessage(undefined);
  }

  async function save() {
    if (!editingId || !form) return;
    setSaving(true);
    setMessage(undefined);
    try {
      await orderMaintenance.update(editingId, form, await token());
      setEditingId(undefined);
      setForm(undefined);
      await orders.refresh();
      await geofenceCoverage.refresh();
      setMessage("Job amended successfully. Planner data has been refreshed from the saved order.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be amended.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(order: TransportOrder) {
    if (!window.confirm(`Delete ${order.reference}? The job will be cancelled for audit purposes and removed from any run.`)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await orderMaintenance.cancel(order.id, await token());
      await orders.refresh();
      setMessage(`${order.reference} cancelled. ${result.removedStops ? `${result.removedStops} linked run stop${result.removedStops === 1 ? " was" : "s were"} removed.` : "It was not attached to a run."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAllOpenJobs() {
    if (!window.confirm("Clear ALL open jobs currently in the TMS? Delivered history will be retained, but every other open job will be cancelled and removed from planning.")) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await request<{ cancelled: number; removedStops: number; message: string }>("/api/v1/orders/open", await token(), { method: "DELETE" });
      setEditingId(undefined);
      setForm(undefined);
      await orders.refresh();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Open jobs could not be cleared.");
    } finally {
      setSaving(false);
    }
  }

  const set = (name: keyof OrderUpdatePayload, value: string) => setForm((current) => current ? ({ ...current, [name]: name === "pallets" ? (value === "" ? undefined : Number(value)) : value }) : current);
  const unitLabel = form?.unitType || "Pallets";

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Order control</p><h1>Manage imported jobs</h1><p className="intro">Amend imported work or remove it from planning without destroying the audit record.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => void Promise.all([orders.refresh(), geofenceCoverage.refresh()])} disabled={orders.loading || saving}>Refresh jobs</button>
        <button onClick={() => void clearAllOpenJobs()} disabled={saving}>Clear all open jobs</button>
      </div>
    </div>
    <div className="planner-toolbar">
      <label>Job date <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setEditingId(undefined); setForm(undefined); }} /></label>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, order, depot, address…" />
      <span>{rows.length} active job{rows.length === 1 ? "" : "s"}</span>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {orders.error && <p className="notice inline-notice">{orders.error}</p>}
    {geofenceCoverage.error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>⚠ Site/geofence coverage could not be checked. Orders remain available, but location linkage is unconfirmed.</p>}
    <SiteCoverageWarningPanel issues={geofenceCoverage.issues} title="ORDER SITE / GEOFENCE COVERAGE" />
    <div className="master-table-wrap" style={{ overflowX: "auto" }}>
      <table className="master-table" style={{ minWidth: 1250 }}>
        <thead><tr><th>Order</th><th>Customer</th><th>Collection</th><th>Depot</th><th>Destination</th><th>Delivery address</th><th>Quantity</th><th>Unit</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((order) => <tr key={order.id}>
          <td><strong>{order.reference}</strong></td>
          <td>{order.customerCode}</td>
          <td>{order.sellerName || "—"}<GeofenceStatusBadge result={geofenceCoverage.resultFor(order.sellerName)} /></td>
          <td>{order.marketName || "—"}<GeofenceStatusBadge result={geofenceCoverage.resultFor(order.marketName)} /></td>
          <td>{order.stallNumber || "—"}<GeofenceStatusBadge result={geofenceCoverage.resultFor(order.stallNumber)} /></td>
          <td>{tagged(order.driverInstructions, "Delivery address") || "—"}</td>
          <td>{order.pallets ?? "—"}</td><td>{tagged(order.driverInstructions, "Unit type") || "Pallets"}</td><td>{order.status}</td>
          <td><div style={{ display: "flex", gap: 8 }}><button onClick={() => begin(order)}>Edit</button><button onClick={() => void cancel(order)} disabled={saving}>Delete</button></div></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!orders.loading && !rows.length && <p className="state">No active imported jobs for this date.</p>}

    {editingId && form && <div className="job-edit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setEditingId(undefined); setForm(undefined); } }}>
      <section className="job-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit job ${form.reference}`}>
        <div className="job-edit-modal-header">
          <div><p className="eyebrow">Edit job</p><h2>{form.reference}</h2></div>
          <button onClick={() => { setEditingId(undefined); setForm(undefined); }} disabled={saving}>Close</button>
        </div>
        <div className="job-edit-modal-body">
          <div className="form-grid">
            <label>Order / reference<input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></label>
            <label>Customer<input value={form.customerCode} onChange={(e) => set("customerCode", e.target.value)} /></label>
            <label>Collection date<input type="date" value={form.collectionDate} onChange={(e) => set("collectionDate", e.target.value)} /></label>
            <label>Delivery date<input type="date" value={form.deliveryDate || ""} onChange={(e) => set("deliveryDate", e.target.value)} /></label>
            <label>Collection site<input value={form.collectionSite || ""} onChange={(e) => set("collectionSite", e.target.value)} /></label>
            <label>Depot ID<input value={form.depotId || ""} onChange={(e) => set("depotId", e.target.value)} /></label>
            <label>Destination<input value={form.destination || ""} onChange={(e) => set("destination", e.target.value)} /></label>
            <label>Delivery address / postcode<input value={form.deliveryAddress || ""} onChange={(e) => set("deliveryAddress", e.target.value)} /></label>
            <label>Quantity<input inputMode="numeric" value={form.pallets ?? ""} onChange={(e) => set("pallets", e.target.value)} /></label>
            <label>Unit type<select value={unitLabel} onChange={(e) => set("unitType", e.target.value)}><option>Pallets</option><option>Trays</option><option>Trolleys</option></select></label>
            <label>Customer ref<input value={form.customerRef || ""} onChange={(e) => set("customerRef", e.target.value)} /></label>
            <label>PO ref<input value={form.poRef || ""} onChange={(e) => set("poRef", e.target.value)} /></label>
            <label>{unitLabel === "Pallets" ? "Pallet / product" : "Product / load description"}<input value={form.palletName || ""} onChange={(e) => set("palletName", e.target.value)} /></label>
          </div>
        </div>
        <div className="job-edit-modal-footer">
          <button onClick={() => { setEditingId(undefined); setForm(undefined); }} disabled={saving}>Cancel</button>
          <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save job changes"}</button>
        </div>
      </section>
    </div>}
  </section>;
}
