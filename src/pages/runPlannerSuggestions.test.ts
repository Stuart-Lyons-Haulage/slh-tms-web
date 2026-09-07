import { describe, expect, it } from "vitest";
import { suggestJobsForRun } from "./runPlannerSuggestions";

describe("suggestJobsForRun", () => {
  const sites = [
    { name: "Selsey", externalCode: "SEL", operationalRegion: "South East", active: true },
    { name: "Leeds", externalCode: "LDS", operationalRegion: "North", active: true },
    { name: "York", externalCode: "YRK", operationalRegion: "North", active: true },
    { name: "Newcastle", externalCode: "NCL", operationalRegion: "North", active: true },
    { name: "Bristol", externalCode: "BRI", operationalRegion: "West / Wales", active: true },
    { name: "Cardiff", externalCode: "CDF", operationalRegion: "West / Wales", active: true },
  ];

  it("prioritises jobs that share the current lane or collect from an existing delivery", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [
        { id: "current", reference: "CURRENT", collection: "Selsey", destination: "Leeds", outstandingPallets: 8 },
        { id: "same-lane", reference: "SAME", collection: "Selsey", destination: "York", outstandingPallets: 6 },
        { id: "chain", reference: "CHAIN", collection: "Leeds", destination: "Newcastle", outstandingPallets: 4 },
        { id: "unrelated", reference: "OTHER", collection: "Bristol", destination: "Cardiff", outstandingPallets: 3 },
      ],
      sites,
      12,
    );

    expect(suggestions.map((item) => item.order.id)).toEqual(["same-lane", "chain"]);
    expect(suggestions[0].reasons).toContain("Same collection");
    expect(suggestions[1].reasons).toContain("Collects from an existing delivery");
    expect(suggestions.every((item) => item.order.id !== "current")).toBe(true);
  });

  it("favours an order that fits the remaining run capacity", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [
        { id: "fits", reference: "FITS", collection: "Selsey", destination: "York", outstandingPallets: 4 },
        { id: "oversize", reference: "BIG", collection: "Selsey", destination: "York", outstandingPallets: 18 },
      ],
      sites,
      5,
    );

    expect(suggestions[0].order.id).toBe("fits");
    expect(suggestions[0].reasons).toContain("Fits remaining capacity");
  });
});
