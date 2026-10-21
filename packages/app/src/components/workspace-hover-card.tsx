import { LinearIssueLinks } from "@/components/linear-issue-links";
import { LinearIssueMetadata } from "@/components/linear-issue-metadata";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Dimensions, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Anchor,
  Check,
  Copy,
  FileDiff,
  Folder,
  GitBranch,
  Plug,
  ChevronRight,
  ExternalLink,
  Server,
  Tag,
} from "lucide-react-native";
import type { LinearIssue } from "@getpaseo/protocol/messages";
import { LinearIcon } from "@/components/icons/linear-icon";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type { Theme } from "@/styles/theme";
import { DiffStat } from "@/components/diff-stat";
import { Pressable } from "react-native";
import type {
  GestureResponderEvent,
  LayoutChangeEvent,
  PointerEvent as NativePointerEvent,
} from "react-native";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { PrHint } from "@/git/use-pr-status-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { openExternalUrl } from "@/utils/open-external-url";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useToast } from "@/contexts/toast-context";
import { PrBadge } from "@/components/sidebar-workspace-list";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useHoverIntent } from "@/hooks/use-hover-intent";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { CheckIndicator } from "@/components/sidebar/workspace-meta-row/check-indicator";
import { selectCheckSummary } from "@/components/sidebar/workspace-meta-row/check-summary";
import type { WorkspacePort } from "@getpaseo/protocol/messages";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { useIsCompactFormFactor } from "@/constants/layout";
import { FloatingSurface } from "@/components/ui/floating";
import { isWeb } from "@/constants/platform";
import { useHosts } from "@/runtime/host-runtime";
import { buildForgeChecksUrl } from "@/git/forge-url";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import { WorkspaceLabelChip } from "@/workspace-labels/chip";
import { useKeepSidebarRevealed } from "@/components/sidebar/hover-context";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

function computeHoverCardPosition({
  triggerRect,
  contentSize,
  displayArea,
  offset,
}: {
  triggerRect: Rect;
  contentSize: { width: number; height: number };
  displayArea: Rect;
  offset: number;
}): { x: number; y: number } {
  let x = triggerRect.x + triggerRect.width + offset;
  let y = triggerRect.y;

  // If it overflows right, try left
  if (x + contentSize.width > displayArea.width - 8) {
    x = triggerRect.x - contentSize.width - offset;
  }

  // Constrain to screen
  const padding = 8;
  x = Math.max(padding, Math.min(displayArea.width - contentSize.width - padding, x));
  y = Math.max(
    displayArea.y + padding,
    Math.min(displayArea.y + displayArea.height - contentSize.height - padding, y),
  );

  return { x, y };
}

const HOVER_CARD_WIDTH = 260;

enum HoverPanel {
  Ports,
  LinearIssues,
}

interface WorkspaceHoverCardProps {
  workspace: SidebarWorkspaceEntry;
  prHint: PrHint | null;
  isDragging: boolean;
  disabled?: boolean;
}

export function WorkspaceHoverCard({
  workspace,
  prHint,
  isDragging,
  disabled = false,
  children,
}: PropsWithChildren<WorkspaceHoverCardProps>): ReactNode {
  const isCompact = useIsCompactFormFactor();

  if (!isWeb || isCompact) {
    return children;
  }

  return (
    <WorkspaceHoverCardDesktop
      workspace={workspace}
      prHint={prHint}
      isDragging={isDragging}
      disabled={disabled}
    >
      {children}
    </WorkspaceHoverCardDesktop>
  );
}

function WorkspaceHoverCardDesktop({
  workspace,
  prHint,
  isDragging,
  disabled = false,
  children,
}: PropsWithChildren<WorkspaceHoverCardProps>): ReactElement {
  const triggerRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  useKeepSidebarRevealed(open);
  const triggerHoveredRef = useRef(false);

  // While open, the safe zone covers trigger + content + the bridge between
  // them. Close only fires when the pointer leaves the safe zone; re-entering
  // it (including the bridge) cancels the pending close.
  const { scheduleClose, cancelClose } = useHoverSafeZone({
    enabled: open,
    triggerRef,
    contentRef,
    onClose: () => setOpen(false),
  });

  const handleTriggerEnter = useCallback(() => {
    triggerHoveredRef.current = true;
    cancelClose();
    if (!isDragging && !disabled) {
      setOpen(true);
    }
  }, [cancelClose, disabled, isDragging]);

  const handleTriggerLeave = useCallback(() => {
    triggerHoveredRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  // Close while another row interaction owns attention.
  useEffect(() => {
    if (isDragging || disabled) {
      cancelClose();
      setOpen(false);
    }
  }, [cancelClose, disabled, isDragging]);

  return (
    <View
      ref={triggerRef}
      collapsable={false}
      onPointerEnter={handleTriggerEnter}
      onPointerLeave={handleTriggerLeave}
    >
      {children}
      {open ? (
        <WorkspaceHoverCardContent
          workspace={workspace}
          prHint={prHint}
          triggerRef={triggerRef}
          contentRef={contentRef}
        />
      ) : null}
    </View>
  );
}

function WorkspaceHoverCardContent({
  workspace,
  prHint,
  triggerRef,
  contentRef,
}: {
  workspace: SidebarWorkspaceEntry;
  prHint: PrHint | null;
  triggerRef: React.RefObject<View | null>;
  contentRef: React.RefObject<View | null>;
}): ReactElement | null {
  const { t } = useTranslation();
  const { status } = useCheckoutStatusQuery({
    serverId: workspace.serverId,
    cwd: workspace.workspaceDirectory,
  });
  const ports = workspace.ports;
  const sidePanel = useHoverIntent();
  const [activePanel, setActivePanel] = useState<HoverPanel>();
  const issues = workspace.linearIssues;
  const [mainHeight, setMainHeight] = useState<number>();
  const handleMainLayout = useCallback((event: LayoutChangeEvent) => {
    setMainHeight(event.nativeEvent.layout.height);
  }, []);
  const openPanelNow = sidePanel.openNow;
  const openPorts = useCallback(() => {
    setActivePanel(HoverPanel.Ports);
    openPanelNow();
  }, [openPanelNow]);
  const openIssues = useCallback(() => {
    setActivePanel(HoverPanel.LinearIssues);
    openPanelNow();
  }, [openPanelNow]);
  const issuesRowRef = useRef<View>(null);
  const portsRowRef = useRef<View>(null);
  const schedulePanelClose = sidePanel.scheduleClose;
  const handleMainPointerMove = useCallback(
    (event: NativePointerEvent) => {
      const target: unknown = event.target;
      const sourceRows = [portsRowRef.current, issuesRowRef.current];
      // Keep document pointer events intact: the hovercard safe zone also reads them.
      if (isWeb && target instanceof Node) {
        if (sourceRows.some((row) => row instanceof Node && row.contains(target))) return;
      }
      schedulePanelClose();
    },
    [schedulePanelClose],
  );
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  // Measure trigger — same pattern as tooltip.tsx
  useEffect(() => {
    if (!triggerRef.current) return;

    let cancelled = false;
    measureElement(triggerRef.current).then((rect) => {
      if (cancelled) return;
      setTriggerRect(rect);
      return;
    });

    return () => {
      cancelled = true;
    };
  }, [triggerRef]);

  // Compute position when both measurements are available
  useEffect(() => {
    if (!triggerRect || !contentSize) return;
    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
    const displayArea = { x: 0, y: 0, width: screenWidth, height: screenHeight };
    const result = computeHoverCardPosition({
      triggerRect,
      contentSize,
      displayArea,
      offset: 4,
    });
    setPosition(result);
  }, [triggerRect, contentSize]);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = event.nativeEvent.layout;
      setContentSize({ width, height });
    },
    [],
  );

  const frameStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: position?.y ?? -9999,
      left: position?.x ?? -9999,
    }),
    [position?.x, position?.y],
  );

  return createPortal(
    <View pointerEvents="box-none" style={styles.portalOverlay}>
      <FloatingSurface
        ref={contentRef}
        entering={FadeIn.duration(80)}
        exiting={FadeOut.duration(80)}
        collapsable={false}
        onLayout={handleLayout}
        accessibilityRole="menu"
        accessibilityLabel={t("workspace.hoverCard.scriptsAccessibility")}
        testID="workspace-hover-card"
        style={styles.card}
        frameStyle={frameStyle}
      >
        <View style={styles.cardColumns}>
          <View
            style={styles.cardMain}
            onLayout={handleMainLayout}
            onPointerEnter={sidePanel.scheduleClose}
            onPointerMove={handleMainPointerMove}
            onPointerLeave={sidePanel.cancelClose}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} testID="hover-card-workspace-name">
                {workspace.name}
              </Text>
            </View>
            {issues?.length ? (
              <View ref={issuesRowRef} onPointerEnter={openIssues}>
                <LinearIssuesSummary issues={issues} onOpen={openIssues} />
              </View>
            ) : null}
            {prHint ? <PullRequestRow hint={prHint} /> : null}
            {workspace.diffStat ? (
              <View style={styles.cardInfoRow}>
                <ThemedFileDiff size={12} uniProps={foregroundMutedColorMapping} />
                <DiffStat
                  additions={workspace.diffStat.additions}
                  deletions={workspace.diffStat.deletions}
                />
              </View>
            ) : null}
            <HostRow serverId={workspace.serverId} />
            {workspace.currentBranch ? (
              <CopyableInfoRow
                icon={ThemedGitBranch}
                value={workspace.currentBranch}
                copyValue={workspace.currentBranch}
                copyLabel={t("workspace.hoverCard.copyBranchName")}
                testID="hover-card-workspace-branch"
              />
            ) : null}
            {status?.baseRefLabel ? (
              <CopyableInfoRow
                icon={ThemedAnchor}
                value={status.baseRefLabel}
                copyValue={status.baseRefLabel}
                copyLabel={`${t("baseRefSwitcher.title")}: ${status.baseRefLabel}. ${t("workspace.hoverCard.copyBranchName")}`}
                testID="hover-card-workspace-base-branch"
              />
            ) : null}
            {workspace.workspaceDirectoryLabel ? (
              <CopyableInfoRow
                icon={ThemedFolder}
                value={workspace.workspaceDirectoryLabel}
                copyValue={workspace.workspaceDirectory}
                copyLabel={t("workspace.hoverCard.copyPath")}
                testID="hover-card-workspace-cwd"
              />
            ) : null}
            {ports?.length ? (
              <View ref={portsRowRef} onPointerEnter={openPorts}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("workspace.hoverCard.portsAccessibility", {
                    ports: ports.map((port) => port.port).join(", "),
                  })}
                  onPress={openPorts}
                  style={[styles.cardInfoRow, styles.defaultCursor]}
                  testID="hover-card-workspace-ports"
                >
                  <ThemedPlug size={12} uniProps={foregroundMutedColorMapping} />
                  <Text style={styles.cardInfoText} numberOfLines={1}>
                    {ports.map((port) => port.port).join(", ")}
                  </Text>
                  <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
                </Pressable>
              </View>
            ) : null}
            <LabelsRow serverId={workspace.serverId} names={workspace.labels} />
          </View>
          {sidePanel.open ? (
            <WorkspaceDetailsPanel
              activePanel={activePanel}
              ports={ports}
              issues={issues}
              serverId={workspace.serverId}
              cancelClose={sidePanel.cancelClose}
              maxHeight={mainHeight}
            />
          ) : null}
        </View>
      </FloatingSurface>
    </View>,
    getOverlayRoot(),
  );
}

function LinearIssuesSummary({
  issues,
  onOpen,
}: {
  issues: readonly LinearIssue[];
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.cardInfoRow, styles.defaultCursor]}
      testID="hover-card-workspace-linear-issues"
    >
      <ThemedLinear size={12} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.cardInfoText} numberOfLines={1}>
        <LinearIssueLinks issues={issues} style={styles.issueSummaryLink} />
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={styles.defaultCursor}
        accessibilityLabel={t("workspace.hoverCard.issuesAccessibility", {
          issues: issues.map((issue) => issue.identifier).join(", "),
        })}
      >
        <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
      </Pressable>
    </View>
  );
}

function WorkspaceDetailsPanel({
  activePanel,
  ports,
  issues,
  serverId,
  cancelClose,
  maxHeight,
}: {
  maxHeight?: number;
  activePanel?: HoverPanel;
  ports?: readonly WorkspacePort[];
  issues?: readonly LinearIssue[];
  serverId: string;
  cancelClose: () => void;
}) {
  const { t } = useTranslation();
  if (activePanel === HoverPanel.Ports && ports?.length) {
    return (
      <View style={styles.portsPanel} onPointerEnter={cancelClose} testID="hover-card-ports-panel">
        <View style={styles.panelHeader}>
          <ThemedPlug size={12} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.panelTitle}>{t("workspace.hoverCard.livePorts")}</Text>
        </View>
        <PortsList ports={ports} serverId={serverId} />
      </View>
    );
  }
  if (activePanel === HoverPanel.LinearIssues && issues?.length && maxHeight) {
    return (
      <View
        style={styles.issuesPanel(maxHeight)}
        onPointerEnter={cancelClose}
        testID="hover-card-linear-panel"
      >
        <View style={styles.panelHeader}>
          <ThemedLinear size={12} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.panelTitle}>{t("workspace.hoverCard.linearIssues")}</Text>
        </View>
        <ScrollView style={styles.issueList}>
          {issues.map((issue) => (
            <LinearIssueRow key={issue.url} issue={issue} />
          ))}
        </ScrollView>
      </View>
    );
  }
  return null;
}

const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedLinear = withUnistyles(LinearIcon);
const ThemedPlug = withUnistyles(Plug);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedAnchor = withUnistyles(Anchor);
const ThemedFolder = withUnistyles(Folder);
const ThemedServer = withUnistyles(Server);
const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedTag = withUnistyles(Tag);

type CardInfoIcon = React.ComponentType<React.ComponentProps<typeof ThemedGitBranch>>;

function HostRow({ serverId }: { serverId: string }): ReactElement | null {
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);
  const label = host?.label?.trim() || serverId;

  return <InfoRow icon={ThemedServer} value={label} testID="hover-card-workspace-host" />;
}

function LabelsRow({
  serverId,
  names,
}: {
  serverId: string;
  names: readonly string[] | undefined;
}): ReactElement | null {
  const labels = useWorkspaceLabelDefinitions(serverId, names);
  if (labels.length === 0) return null;

  return (
    <View style={styles.cardInfoRow} testID="hover-card-workspace-labels">
      <ThemedTag size={12} uniProps={foregroundMutedColorMapping} />
      <View style={styles.cardLabels}>
        {labels.map((label) => (
          <WorkspaceLabelChip key={workspaceLabelKey(label.name)} label={label} />
        ))}
      </View>
    </View>
  );
}

const ThemedCopy = withUnistyles(Copy);
const ThemedCheck = withUnistyles(Check);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function InfoRow({
  icon: Icon,
  value,
  testID,
}: {
  icon: CardInfoIcon;
  value: string;
  testID: string;
}) {
  return (
    <View style={styles.cardInfoRow}>
      <Icon size={12} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.cardInfoText} numberOfLines={1} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function CopyableInfoRow({
  icon: Icon,
  value,
  copyValue,
  copyLabel,
  testID,
}: {
  icon: CardInfoIcon;
  value: string;
  copyValue: string;
  copyLabel: string;
  testID: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const { copied, markCopied } = useCopyFeedback();

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const handlePress = useCallback(() => {
    void copyToClipboard(copyValue);
    markCopied();
  }, [copyValue, markCopied]);

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  let iconUniProps = foregroundMutedColorMapping;
  if (copied || isHovered) {
    iconUniProps = foregroundColorMapping;
  }
  const textStyle =
    copied || isHovered ? [styles.cardInfoText, styles.cardInfoTextHovered] : styles.cardInfoText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copyLabel}
      style={styles.cardInfoRow}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
    >
      {(() => {
        if (copied) {
          return <ThemedCheck size={12} uniProps={iconUniProps} />;
        }
        if (isHovered) {
          return <ThemedCopy size={12} uniProps={iconUniProps} />;
        }
        return <Icon size={12} uniProps={iconUniProps} />;
      })()}
      <Text style={textStyle} numberOfLines={1} testID={testID}>
        {value}
      </Text>
    </Pressable>
  );
}

const PR_BADGE_VARIANTS: Record<PrHint["state"], StatusBadgeVariant> = {
  open: "success",
  merged: "merged",
  closed: "error",
  draft: "muted",
};

function PullRequestRow({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const summary = selectCheckSummary(hint);
  const openChecks = useCallback(() => {
    void openExternalUrl(buildForgeChecksUrl(hint.forge, hint.url) ?? hint.url);
  }, [hint.forge, hint.url]);
  return (
    <View style={styles.cardInfoRow}>
      <PrBadge hint={hint} />
      {summary ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t(`workspace.git.pr.checksSummary.${summary.state}Accessible`)}
              onPress={openChecks}
              hitSlop={4}
              testID="hover-card-checks"
            >
              <CheckIndicator summary={summary} size={12} />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent>
            <Text style={styles.checksTooltipText}>
              {t(`workspace.git.pr.checksSummary.${summary.state}Accessible`)}
            </Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      <StatusBadge
        label={t(`workspace.git.pr.states.${hint.state}`)}
        variant={PR_BADGE_VARIANTS[hint.state]}
        size="xs"
      />
    </View>
  );
}

function PortsList({ ports, serverId }: { ports: readonly WorkspacePort[]; serverId: string }) {
  const isLocal = useIsLocalDaemon(serverId);
  return (
    <>
      {ports.map((port) => (
        <PortRow key={`${port.host}:${port.port}:${port.pid}`} port={port} isLocal={isLocal} />
      ))}
    </>
  );
}

function PortRow({ port, isLocal }: { port: WorkspacePort; isLocal: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { copied, markCopied } = useCopyFeedback();
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const host = port.host.includes(":") ? `[${port.host}]` : port.host;
  const address = `${host}:${port.port}`;
  const copyAddress = useCallback(() => {
    void copyToClipboard(address)
      .then(markCopied)
      .catch(() => toast.error(t("workspace.tabs.toasts.copyFailed")));
  }, [address, markCopied, t, toast]);
  const openPort = useCallback(
    () => void openExternalUrl(`http://localhost:${port.port}`),
    [port.port],
  );
  return (
    <View
      style={styles.portHoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View style={[styles.portRow, hovered && styles.listRowHovered]}>
        <Text style={styles.portNumber} pointerEvents="none">
          {port.port}
        </Text>
        <Text style={styles.portProcess} selectable={false} pointerEvents="none">
          {port.processName}
        </Text>
        <View style={styles.portAddressSlot}>
          <Text
            style={[styles.portAddress, hovered && styles.hidden]}
            numberOfLines={1}
            pointerEvents="none"
          >
            {address}
          </Text>
          <View
            style={[styles.portActions, !hovered && styles.hidden]}
            pointerEvents={hovered ? "auto" : "none"}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copied ? t("common.states.copied") : t("common.actions.copy")}: ${address}`}
              onPress={copyAddress}
              style={styles.portAction}
              tabIndex={hovered ? 0 : -1}
            >
              {copied ? (
                <ThemedCheck size={12} uniProps={foregroundColorMapping} />
              ) : (
                <ThemedCopy size={12} uniProps={foregroundMutedColorMapping} />
              )}
            </Pressable>
            {isLocal ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${address}, ${t("workspace.hoverCard.openInBrowser")}`}
                onPress={openPort}
                style={styles.portAction}
                tabIndex={hovered ? 0 : -1}
              >
                <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function LinearIssueRow({ issue }: { issue: LinearIssue }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { copied, markCopied } = useCopyFeedback();
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const copyIdentifier = useCallback(() => {
    void copyToClipboard(issue.identifier)
      .then(markCopied)
      .catch(() => toast.error(t("workspace.tabs.toasts.copyFailed")));
  }, [issue.identifier, markCopied, t, toast]);
  const openIssue = useCallback(() => void openExternalUrl(issue.url), [issue.url]);

  return (
    <View
      style={styles.portHoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View
        style={[styles.issueRow, hovered && styles.listRowHovered]}
        testID={`hover-card-linear-issue-${issue.identifier}`}
      >
        <View style={styles.issueHeader}>
          <View style={styles.issueIdentity}>
            <Text style={styles.issueIdentifier} selectable={false} pointerEvents="none">
              {issue.identifier}
            </Text>
            <LinearIssueMetadata issue={issue} />
          </View>
          <View
            style={[styles.issueActions, !hovered && styles.hidden]}
            pointerEvents={hovered ? "auto" : "none"}
          >
            <Pressable
              accessibilityRole="button"
              onPress={copyIdentifier}
              accessibilityLabel={`${copied ? t("common.states.copied") : t("common.actions.copy")}: ${issue.identifier}`}
              style={styles.portAction}
              tabIndex={hovered ? 0 : -1}
            >
              {copied ? (
                <ThemedCheck size={12} uniProps={foregroundColorMapping} />
              ) : (
                <ThemedCopy size={12} uniProps={foregroundMutedColorMapping} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={openIssue}
              accessibilityLabel={`${issue.identifier}, ${t("workspace.hoverCard.openInLinear")}`}
              style={styles.portAction}
              tabIndex={hovered ? 0 : -1}
            >
              <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.issueTitle} selectable={false} pointerEvents="none">
          {issue.title || t("workspace.hoverCard.issueTitleUnavailable")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  checksTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  portalOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: OVERLAY_Z.tooltip,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingTop: theme.spacing[2],

    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  cardColumns: { flexDirection: "row" },
  cardMain: {
    width: HOVER_CARD_WIDTH,
    alignSelf: "flex-start",
    paddingBottom: theme.spacing[1],
  },
  portsPanel: {
    maxWidth: 290,
    minWidth: 0,
    flexShrink: 1,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingBottom: theme.spacing[2],
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  panelTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  issuesPanel: (maxHeight: number) => ({
    maxHeight,
    width: 340,
    minWidth: 0,
    flexShrink: 1,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingBottom: theme.spacing[2],
  }),
  issueList: { flexShrink: 1 },
  issueSummaryLink: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  issueRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  issueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
  },
  issueIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  issueIdentifier: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  issueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  issueTitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  portHoverTarget: { position: "relative" },
  portRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingHorizontal: theme.spacing[3],
  },
  portNumber: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
    color: theme.colors.foreground,
  },
  portProcess: {
    flexGrow: 1,
    flexShrink: 1,
    overflowWrap: "anywhere",
    minWidth: 0,
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  portAddressSlot: {
    flexShrink: 0,
    minWidth: 48,
    minHeight: 24,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  portAddress: { maxWidth: 130, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  portActions: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  portAction: { padding: theme.spacing[1] },
  hidden: { opacity: 0 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
    minWidth: 0,
  },
  defaultCursor: { cursor: "auto" },
  cardInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardInfoText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  cardLabels: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  cardInfoTextHovered: {
    color: theme.colors.foreground,
  },
  listRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
