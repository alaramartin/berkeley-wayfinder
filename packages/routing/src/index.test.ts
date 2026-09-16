import { describe, expect, it } from "vitest";
import { WALK_SPEED_MPS } from "./index";

describe("routing (skeleton)", () => {
  it("exports constants", () => {
    expect(WALK_SPEED_MPS).toBeGreaterThan(0);
  });
});
