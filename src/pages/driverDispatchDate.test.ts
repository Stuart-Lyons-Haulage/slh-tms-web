import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("Driver Dispatch operating date", () => {
  it("defaults directly opened Dispatch to today rather than tomorrow", () => {
    const source = readFileSync(fileURLToPath(new URL("./DriverDispatch.tsx", import.meta.url)), "utf8");
    expect(source).toContain('initialParams.get("date") || today()');
    expect(source).not.toContain('initialParams.get("date") || tomorrow()');
  });
});
