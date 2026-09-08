import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewSource = readFileSync(new URL("./OrderReviewBulk.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../components/SourceEmailEvidenceDrawer.tsx", import.meta.url), "utf8");

describe("Order Review source email evidence", () => {
  it("offers source evidence directly from flagged bookings", () => {
    expect(reviewSource).toContain("Review source email");
    expect(reviewSource).toContain("SourceEmailEvidenceDrawer");
    expect(reviewSource).toContain("bulk-row-warning");
    expect(reviewSource).toContain("setSourceEmailStagingId(row.item.id)");
  });

  it("loads the retained email through the staged-order evidence endpoint", () => {
    expect(drawerSource).toContain("/api/v1/order-intake/source-email/");
    expect(drawerSource).toContain("Email body");
    expect(drawerSource).toContain("Attachments");
    expect(drawerSource).toContain("Open original in Outlook");
  });
});
