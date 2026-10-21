import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { WorkspacePortsService } from "./service.js";
import type { ListeningPort, ProcessDetails } from "./parse.js";

const logger = pino({ level: "silent" });
const port = { host: "127.0.0.1", port: 3000, pid: 42, processName: "node" };

function setup() {
  const scan = vi.fn(async (details: Map<number, ProcessDetails>): Promise<ListeningPort[]> => {
    details.set(42, { cwd: "/work/app" });
    return [port];
  });
  const onChange = vi.fn(async () => {});
  const service = new WorkspacePortsService({
    logger,
    scan,
    onChange,
    listWorkspaces: async () => [{ workspaceId: "app", cwd: "/work/app" }],
  });
  return { service, scan, onChange };
}

afterEach(() => vi.useRealTimers());

describe("WorkspacePortsService", () => {
  it("scans immediately on first connection, publishes only changes, clears removed ports, and stops when disconnected", async () => {
    vi.useFakeTimers();
    const { service, scan, onChange } = setup();
    expect(scan).not.toHaveBeenCalled();
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(service.getPorts("app")).toEqual([{ ...port, workspaceId: "app" }]);
    expect(onChange).toHaveBeenCalledWith(["app"]);
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    scan.mockResolvedValueOnce([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getPorts("app")).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
    service.setConnected(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(3);
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(4);
    service.setConnected(false);
  });

  it("cannot restart after disposal, including late socket cleanup", async () => {
    vi.useFakeTimers();
    const { service, scan } = setup();
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(0);
    service.dispose();
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never overlaps scans, including a disconnect and reconnect during a pending scan", async () => {
    vi.useFakeTimers();
    const { service, scan } = setup();
    let finish!: (ports: ListeningPort[]) => void;
    scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    service.setConnected(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(scan).toHaveBeenCalledTimes(1);
    service.setConnected(false);
    service.setConnected(true);
    expect(scan).toHaveBeenCalledTimes(1);
    finish([]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(2);
    service.setConnected(false);
  });

  it("does not leave a timer when the last client disconnects during a scan", async () => {
    vi.useFakeTimers();
    const { service, scan, onChange } = setup();
    let finish!: (ports: ListeningPort[]) => void;
    scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    service.setConnected(true);
    service.setConnected(false);
    finish([]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
