import { beforeEach, describe, expect, it } from "vitest";
import { buildHostWorkspaceOpenRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { leavingWorkspaceKey, markLeavingWorkspace } from "./leaving-workspace";

const current = { serverId: "srv", workspaceId: "/repo/a" };

describe("markLeavingWorkspace", () => {
  beforeEach(() => {
    leavingWorkspaceKey.value = undefined;
  });

  it("marks the current workspace when navigating to another workspace", () => {
    markLeavingWorkspace({
      from: current,
      route: buildHostWorkspaceOpenRoute("srv", "/repo/b", "agent:a1"),
    });
    expect(leavingWorkspaceKey.value).toBe("srv:/repo/a");
  });

  it("leaves the current workspace visible when the route stays in it", () => {
    markLeavingWorkspace({ from: current, route: buildHostWorkspaceRoute("srv", "/repo/a") });
    expect(leavingWorkspaceKey.value).toBeUndefined();
  });
});
