import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("bootstrap", () => {
  it("deve conseguir criar a aplicação sem lançar erro", () => {
    expect(() => createApp()).not.toThrow();
  });
});
