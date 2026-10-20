/**
 * @vitest-environment jsdom
 */
import React, { useState, type PropsWithChildren } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@/i18n/resources/en";
import { useMenuContext } from "@/components/ui/menu/menu-context";
import { HistoryFilterBar } from "./filters";
import { EMPTY_HISTORY_FILTERS, type HistoryFilters } from "./preferences";

const layout = vi.hoisted(() => ({ compact: false }));
const hosts = vi.hoisted(() => [
  { serverId: "one", label: "First" },
  { serverId: "two", label: "Second" },
]);
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [...hosts],
  useHostRuntimeConnectionStatus: () => "online",
}));
// Keep the actual menu state, trigger, header and checkbox rows; geometry needs a browser.
vi.mock("@/components/ui/menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/menu")>()),
  MenuSurface: function TestSurface({ children }: PropsWithChildren) {
    return useMenuContext("TestSurface").open ? children : null;
  },
}));
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } }, initAsync: false });

beforeEach(() => {
  vi.stubGlobal("React", React);
  layout.compact = false;
  hosts.splice(2);
});
afterEach(cleanup);

const options = {
  projects: [
    { projectKey: "alpha", projectName: "Alpha" },
    { projectKey: "beta", projectName: "Beta" },
  ],
  models: [
    { provider: "codex", model: "gpt" },
    { provider: "claude", model: "opus" },
  ],
};
function Filters() {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  return (
    <I18nextProvider i18n={i18n}>
      <HistoryFilterBar
        filters={filters}
        onChange={setFilters}
        supported
        agentTypeSupported
        options={options}
      />
    </I18nextProvider>
  );
}

describe("History filter checkboxes", () => {
  it.each([
    ["hosts", "All hosts", "No hosts", "First"],
    ["projects", "All projects", "No projects", "Alpha"],
    ["providers", "All providers", "No providers", "Claude"],
    ["models", "All models", "No models", "opus"],
    ["agentType", "All agents", "No agents", "Main agents"],
    ["status", "All sessions", "No sessions", "Active"],
  ])(
    "toggles every %s checkbox without closing the menu",
    (group, allLabel, noLabel, firstLabel) => {
      const view = render(<Filters />);
      const trigger = view.getByTestId(`sessions-${group}-filter-trigger`);
      expect(trigger.textContent).toBe(allLabel);
      fireEvent.click(trigger);
      const all = view.getByTestId(`sessions-${group}-filter-all`);
      const items = () => view.getAllByTestId(new RegExp(`^sessions-${group}-filter-item-`));
      expect(all.textContent).toBe("Deselect all");
      for (const item of items()) expect(item.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(all);
      expect(all.textContent).toBe("Select all");
      expect(trigger.textContent).toBe(noLabel);
      for (const item of items()) expect(item.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(items()[0]);
      expect(items()[0].getAttribute("aria-checked")).toBe("true");
      expect(items()[1].getAttribute("aria-checked")).toBe("false");
      expect(all.textContent).toBe("Select all");
      expect(trigger.textContent).toBe(firstLabel);
      fireEvent.click(items()[1]);
      expect(trigger.textContent).toBe(allLabel);
      expect(all.textContent).toBe("Deselect all");
      fireEvent.click(items()[0]);
      expect(items()[0].getAttribute("aria-checked")).toBe("false");
      expect(items()[1].getAttribute("aria-checked")).toBe("true");
      fireEvent.click(view.getByRole("button", { name: "Clear filters" }));
      expect(trigger.textContent).toBe(allLabel);
      for (const item of items()) expect(item.getAttribute("aria-checked")).toBe("true");
    },
  );

  it("labels partial selections by count and includes newly added hosts after clearing", () => {
    hosts.push({ serverId: "three", label: "Third" });
    const view = render(<Filters />);
    fireEvent.click(view.getByTestId("sessions-hosts-filter-trigger"));
    fireEvent.click(view.getByTestId("sessions-hosts-filter-item-one"));
    expect(view.getByTestId("sessions-hosts-filter-trigger").textContent).toBe("Hosts (2)");
    fireEvent.click(view.getByRole("button", { name: "Clear filters" }));
    hosts.push({ serverId: "four", label: "Fourth" });
    view.rerender(<Filters />);
    expect(view.getByTestId("sessions-hosts-filter-trigger").textContent).toBe("All hosts");
    expect(view.getByTestId("sessions-hosts-filter-item-four").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("keeps every group's bulk action and checkboxes in the compact sheet", () => {
    layout.compact = true;
    const view = render(<Filters />);
    fireEvent.click(view.getByTestId("sessions-filters-trigger"));
    for (const group of ["hosts", "projects", "providers", "models", "agentType", "status"]) {
      const all = view.getByTestId(`sessions-${group}-filter-all`);
      fireEvent.click(all);
      expect(all.textContent).toBe("Select all");
      const items = view.getAllByTestId(new RegExp(`^sessions-${group}-filter-item-`));
      for (const item of items) expect(item.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(items[0]);
      expect(items[0].getAttribute("aria-checked")).toBe("true");
    }
    fireEvent.click(view.getByRole("menuitem", { name: "Clear filters" }));
    for (const item of view.getAllByTestId(/^sessions-.*-filter-item-/))
      expect(item.getAttribute("aria-checked")).toBe("true");
  });
});
