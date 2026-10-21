/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Text, View } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { useRowHover } from "./use-row-hover";

function Row() {
  const { hovered, ...hoverProps } = useRowHover();
  return (
    <View testID="row" {...hoverProps}>
      <Text testID="address">127.0.0.1:3001</Text>
      <Text>{hovered ? "Hovered" : "Idle"}</Text>
    </View>
  );
}

function setup() {
  render(<Row />);
  const row = screen.getByTestId("row");
  const address = screen.getByTestId("address");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    x: 576,
    y: 383,
    left: 576,
    right: 757.09375,
    top: 383,
    bottom: 411,
    width: 181.09375,
    height: 28,
    toJSON() {
      return {};
    },
  });
  fireEvent(
    address,
    new MouseEvent("pointerover", {
      bubbles: true,
      clientX: 672.74609375,
      clientY: 405.828125,
      relatedTarget: document.body,
    }),
  );
  expect(screen.getByText("Hovered")).toBeTruthy();
  return address;
}

function pointerOut(options: MouseEventInit): MouseEvent {
  const event = new MouseEvent("pointerout", { bubbles: true, ...options });
  // jsdom rounds MouseEvent coordinates, but the recorded native events have fractional values.
  Object.defineProperties(event, {
    clientX: { value: options.clientX },
    clientY: { value: options.clientY },
  });
  return event;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("ignores a destination-less native exit that still points inside the row", () => {
  const address = setup();
  fireEvent(
    address,
    pointerOut({
      bubbles: true,
      clientX: 672.74609375,
      clientY: 405.828125,
      relatedTarget: null,
    }),
  );
  expect(screen.getByText("Hovered")).toBeTruthy();
});

it("clears hover for a destination-less exit outside the row", () => {
  const address = setup();
  fireEvent(
    address,
    pointerOut({
      bubbles: true,
      clientX: 672.74609375,
      clientY: 411.5,
      relatedTarget: null,
    }),
  );
  expect(screen.getByText("Idle")).toBeTruthy();
});

it("clears hover when the pointer has a real destination outside the row", () => {
  const address = setup();
  fireEvent(
    address,
    pointerOut({
      bubbles: true,
      clientX: 672.74609375,
      clientY: 405.828125,
      relatedTarget: document.body,
    }),
  );
  expect(screen.getByText("Idle")).toBeTruthy();
});
