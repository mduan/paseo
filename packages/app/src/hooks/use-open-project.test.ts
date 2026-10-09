import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneGithubProjectDirectly,
  getOpenProjectFailureReason,
  openProjectDirectly,
  registerProjectDescriptor,
} from "@/hooks/open-project";
import type { ProjectDescriptor } from "@/stores/session-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { createProjectViewKey } from "@/projects/workspace-structure";

const SERVER_ID = "server-1";
const PROJECT_PATH = "/repo/project";
const PROJECT_VIEW_KEY = createProjectViewKey({ serverId: SERVER_ID, projectId: "project-1" });
const OTHER_PROJECT_VIEW_KEY = createProjectViewKey({
  serverId: "other-server",
  projectId: "project-1",
});

beforeEach(() => {
  useSidebarViewStore.setState({ projectFilters: [] });
});

function buildProjectPayload() {
  return {
    projectId: "project-1",
    projectDisplayName: "project",
    projectRootPath: PROJECT_PATH,
    projectKind: "git" as const,
  };
}

interface RecordedProject {
  serverId: string;
  project: ProjectDescriptor;
}

interface RecordedHydrated {
  serverId: string;
  hydrated: boolean;
}

interface RecordedClone {
  repo: string;
  targetDirectory: string;
  cloneProtocol?: "https" | "ssh";
}

function createFakeSession() {
  const projects: RecordedProject[] = [];
  const hydrated: RecordedHydrated[] = [];
  return {
    projects,
    hydrated,
    upsertProject: (serverId: string, project: ProjectDescriptor) => {
      projects.push({ serverId, project });
    },
    setHasHydratedWorkspaces: (serverId: string, value: boolean) => {
      hydrated.push({ serverId, hydrated: value });
    },
  };
}

function createFakeGithubCloneClient(project: ReturnType<typeof buildProjectPayload> | null) {
  const clones: RecordedClone[] = [];
  return {
    clones,
    cloneGithubProject: async (input: RecordedClone) => {
      clones.push(input);
      return {
        requestId: "request-3",
        repo: "owner/project",
        checkoutPath: PROJECT_PATH,
        error: project ? null : "Project registration failed",
        project,
      };
    },
  };
}

describe("openProjectDirectly", () => {
  it("adds the project and marks workspaces hydrated without opening a workspace", async () => {
    const session = createFakeSession();
    const projectPayload = buildProjectPayload();
    useSidebarViewStore.setState({ projectFilters: [OTHER_PROJECT_VIEW_KEY] });

    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: true,
      client: {
        addProject: async () => ({
          requestId: "request-1",
          error: null,
          project: projectPayload,
        }),
      },
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({ ok: true, project: projectPayload });
    expect(session.projects).toEqual([
      {
        serverId: SERVER_ID,
        project: {
          projectId: "project-1",
          projectKey: null,
          projectDisplayName: "project",
          projectCustomName: null,
          projectCustomIconRevision: null,
          projectKind: "git",
          projectRootPath: PROJECT_PATH,
        },
      },
    ]);
    expect(session.hydrated).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
    expect(useSidebarViewStore.getState().projectFilters).toEqual([
      OTHER_PROJECT_VIEW_KEY,
      PROJECT_VIEW_KEY,
    ]);
  });

  it("fails before sending when the host does not support adding projects without workspaces", async () => {
    const session = createFakeSession();
    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: false,
      client: {
        addProject: async () => ({
          requestId: "request-unsupported",
          error: null,
          project: buildProjectPayload(),
        }),
      },
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: null,
      error: "Update the host to add projects without creating a workspace.",
    });
    expect(session.projects).toEqual([]);
    expect(session.hydrated).toEqual([]);
  });

  it("does not add a project when addProject fails", async () => {
    const session = createFakeSession();
    useSidebarViewStore.setState({ projectFilters: [OTHER_PROJECT_VIEW_KEY] });

    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: true,
      client: {
        addProject: async () => ({
          requestId: "request-2",
          error: "Directory not found: /repo/project",
          errorCode: "directory_not_found" as const,
          project: null,
        }),
      },
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "directory_not_found",
      error: "Directory not found: /repo/project",
    });
    expect(session.projects).toEqual([]);
    expect(session.hydrated).toEqual([]);
    expect(useSidebarViewStore.getState().projectFilters).toEqual([OTHER_PROJECT_VIEW_KEY]);
  });
});

describe("cloneGithubProjectDirectly", () => {
  it("registers a cloned GitHub project without creating a workspace", async () => {
    const session = createFakeSession();
    const projectPayload = buildProjectPayload();
    const github = createFakeGithubCloneClient(projectPayload);
    useSidebarViewStore.setState({ projectFilters: [OTHER_PROJECT_VIEW_KEY] });

    const result = await cloneGithubProjectDirectly({
      serverId: SERVER_ID,
      repo: "owner/project",
      targetDirectory: "~/workspace",
      cloneProtocol: "https",
      isConnected: true,
      client: github,
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({ ok: true, project: projectPayload });
    expect(github.clones).toEqual([
      {
        repo: "owner/project",
        targetDirectory: "~/workspace",
        cloneProtocol: "https",
      },
    ]);
    expect(session.projects).toEqual([
      {
        serverId: SERVER_ID,
        project: {
          ...projectPayload,
          projectCustomName: null,
          projectKey: null,
          projectCustomIconRevision: null,
        },
      },
    ]);
    expect(session.hydrated).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
    expect(useSidebarViewStore.getState().projectFilters).toEqual([
      OTHER_PROJECT_VIEW_KEY,
      PROJECT_VIEW_KEY,
    ]);
  });

  it("does not register a project when cloning fails", async () => {
    const session = createFakeSession();
    const github = createFakeGithubCloneClient(null);
    useSidebarViewStore.setState({ projectFilters: [OTHER_PROJECT_VIEW_KEY] });

    const result = await cloneGithubProjectDirectly({
      serverId: SERVER_ID,
      repo: "owner/project",
      targetDirectory: "~/workspace",
      cloneProtocol: "https",
      isConnected: true,
      client: github,
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: null,
      error: "Project registration failed",
    });
    expect(session.projects).toEqual([]);
    expect(session.hydrated).toEqual([]);
    expect(useSidebarViewStore.getState().projectFilters).toEqual([OTHER_PROJECT_VIEW_KEY]);
  });
});

describe("registerProjectDescriptor", () => {
  it("selects a newly created directory project only once", () => {
    const session = createFakeSession();
    useSidebarViewStore.setState({ projectFilters: [OTHER_PROJECT_VIEW_KEY] });
    const input = {
      serverId: ` ${SERVER_ID} `,
      project: { ...buildProjectPayload(), projectKind: "directory" as const },
      upsertProject: session.upsertProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    };

    expect(registerProjectDescriptor(input)).toBe(true);
    expect(registerProjectDescriptor(input)).toBe(true);

    expect(useSidebarViewStore.getState().projectFilters).toEqual([
      OTHER_PROJECT_VIEW_KEY,
      PROJECT_VIEW_KEY,
    ]);
  });

  it("keeps All projects selected when adding a project", () => {
    const session = createFakeSession();

    expect(
      registerProjectDescriptor({
        serverId: SERVER_ID,
        project: buildProjectPayload(),
        upsertProject: session.upsertProject,
        setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
      }),
    ).toBe(true);

    expect(useSidebarViewStore.getState().projectFilters).toEqual([]);
  });
});

describe("getOpenProjectFailureReason", () => {
  it("keeps the known directory-not-found failure reason", () => {
    expect(
      getOpenProjectFailureReason({
        ok: false,
        errorCode: "directory_not_found",
        error: "Directory not found: /missing",
      }),
    ).toBe("directory_not_found");
  });

  it("uses the generic failure reason for untyped project-open failures", () => {
    expect(getOpenProjectFailureReason({ ok: false, errorCode: null, error: "boom" })).toBe(
      "open_failed",
    );
  });
});
