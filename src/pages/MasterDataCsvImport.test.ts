import { describe, expect, it, vi } from "vitest";
import { applyMasterDataInChunks, compareMasterDataRow, parseMasterDataCsv, parseCsvRows } from "./MasterDataCsvImport";
import type { MasterApplyResponse, StageBatchRequest } from "../lib/api";

describe("MasterDataCsvImport", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsvRows('Driver Number,Driver Name\nD01,"Smith, Alex"\n')).toEqual([["Driver Number", "Driver Name"], ["D01", "Smith, Alex"]]);
  });

  it("maps driver sanity-check headers and normalises licence expiry", () => {
    const parsed = parseMasterDataCsv("Driver Number,Driver Name,Licence Number,Licence Expiry\nD01,Alex Smith,SMITH123,31/12/2027\n", "driver", "drivers.csv");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({ employeeNumber: "D01", displayName: "Alex Smith", drivingLicenceNumber: "SMITH123", licenceExpiry: "2027-12-31" });
  });

  it("flags a changed vehicle fuel PIN for explicit critical review", () => {
    const parsed = parseMasterDataCsv("Registration,Fuel Pin\nBL70RHU,3131\n", "vehicle", "vehicles.csv");
    const diff = compareMasterDataRow("vehicle", parsed.requests[0], [{ registration: "BL70RHU", fuelPin: "9999", bpPlainCard: "YES" }]);
    expect(diff.status).toBe("CRITICAL REVIEW");
    expect(diff.selected).toBe(false);
    expect(diff.differences).toContain("fuelPin");
  });

  it("requires explicit review before adding a new master row", () => {
    const parsed = parseMasterDataCsv("Site Code,Site Name,Aliases\nNEW-SITE,New Site,New Alias\n", "site", "sites.csv");
    const diff = compareMasterDataRow("site", parsed.requests[0], []);
    expect(diff.status).toBe("NEW");
    expect(diff.selected).toBe(false);
  });

  it("marks identical rows unchanged", () => {
    const parsed = parseMasterDataCsv("Route Combination,Pallet Type,Last Despatch\nNWF-Sel-Aldi-Neston,Euro,07:00\n", "sitetimingrule", "timing.csv");
    const diff = compareMasterDataRow("sitetimingrule", parsed.requests[0], [{ routeCombination: "NWF-Sel-Aldi-Neston", palletType: "Euro", lastDespatch: "07:00" }]);
    expect(diff.status).toBe("UNCHANGED");
    expect(diff.selected).toBe(false);
  });

  it("applies large imports in bounded chunks and aggregates the result", async () => {
    const records: StageBatchRequest[] = Array.from({ length: 125 }, (_, index) => ({ entityType: "driver", idempotencyKey: `driver-${index}`, payload: { employeeNumber: `D${index}`, displayName: `Driver ${index}` } }));
    const applyBatch = vi.fn(async (batch: StageBatchRequest[]): Promise<MasterApplyResponse> => ({ received: batch.length, applied: batch.length, failed: 0, results: batch.map(record => ({ entityType: record.entityType, idempotencyKey: record.idempotencyKey, applied: true })) }));
    const result = await applyMasterDataInChunks(records, applyBatch, 50);
    expect(applyBatch).toHaveBeenCalledTimes(3);
    expect(applyBatch.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 25]);
    expect(result.received).toBe(125); expect(result.applied).toBe(125); expect(result.failed).toBe(0); expect(result.results).toHaveLength(125);
  });
});
