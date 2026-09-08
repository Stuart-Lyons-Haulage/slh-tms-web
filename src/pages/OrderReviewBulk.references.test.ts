import { describe, expect, it } from "vitest";
import { driverReference } from "./orderReviewReferences";

describe("crate/tray reference review", () => {
  it("accepts the NWF dump collection reference as the driver reference", () => {
    const payload = {
      jobType: "NWF crate return",
      sourceSubject: "Ocado tray return",
      collectionReference: "228135897",
    };

    expect(driverReference(payload)).toBe("228135897");
  });

  it("continues to flag a crate/tray load when every supported reference is blank", () => {
    const payload = { jobType: "NWF crate return", sourceSubject: "Ocado tray return" };

    expect(driverReference(payload)).toBe("");
  });
});
