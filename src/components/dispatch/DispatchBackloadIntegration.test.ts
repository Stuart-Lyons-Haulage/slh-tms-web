import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const boardSource = readFileSync(new URL("./DispatchBoard.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../../pages/DriverDispatchOperational.tsx", import.meta.url), "utf8");

describe("authoritative Dispatch backload integration", () => {
  it("keeps live backload opportunities inside the authoritative Dispatch board only", () => {
    expect(boardSource).toContain('import { BackloadMatchNotifications } from "../BackloadMatchNotifications";');
    expect(boardSource).toContain("<BackloadMatchNotifications />");
    expect(shellSource).not.toContain("BackloadMatchNotifications");
  });
});
