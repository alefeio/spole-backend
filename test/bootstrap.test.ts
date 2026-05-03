import { describe, expect, it } from "vitest";
import { createTestApp } from "./test-deps";

describe("bootstrap", () => {
  it("deve conseguir criar a aplicação sem lançar erro", () => {
    expect(() => createTestApp()).not.toThrow();
  });
});
