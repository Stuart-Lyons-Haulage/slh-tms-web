import { describe, expect, it } from "vitest";
import { parseMasterDataCsv, parseCsvRows } from "./MasterDataCsvImport";

describe("MasterDataCsvImport", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsvRows('Driver Number,Driver Name\nD01,"Smith, Alex"\n')).toEqual([["Driver Number", "Driver Name"], ["D01", "Smith, Alex"]]);
  });

  it("maps driver sanity-check headers and normalises licence expiry", () => {
    const parsed = parseMasterDataCsv("Driver Number,Driver Name,Licence Number,Licence Expiry\nD01,Alex Smith,SMITH123,31/12/2027\n", "driver", "drivers.csv");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({ employeeNumber: "D01", displayName: "Alex Smith", drivingLicenceNumber: "SMITH123", licenceExpiry: "2027-12-31" });
  });
});
