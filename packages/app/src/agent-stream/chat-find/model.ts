/* eslint-disable typescript/consistent-type-definitions -- Workspace instructions require type aliases. */
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import { createPhrasePattern, SearchQueryError } from "@getpaseo/protocol/search/phrase";
import type { AgentTimelineSearchPayload } from "@getpaseo/client/internal/daemon-client";
import { completedTurnFolds } from "@getpaseo/protocol/turns";
import type { StreamItem } from "@/types/stream";

/**
 * A message the host says contains the query. `count` is the host's estimate of its
 * occurrences until a reveal replaces it with the rendered count, so the whole-chat
 * position the widget shows is exact for every message that has been on screen. The
 * wire field is optional; the search boundary fills it in, so the interior trusts it.
 */
type Location = Omit<AgentTimelineSearchPayload["locations"][number], "count"> & {
  count: number;
};
interface Target {
  id: string;
  seq: number;
  before: number;
}
/**
 * Why a search stopped, so the widget can say something true. `connection` is the
 * host call itself failing, `historyChanged` is the timeline moving under a result
 * set, and `reveal` is a located match that never made it onto the screen.
 */
export type ChatFindFailure = "connection" | "historyChanged" | "reveal";

class ChatFindFailureError extends Error {
  constructor(
    readonly failure: ChatFindFailure,
    options?: { cause: unknown },
  ) {
    super(`Chat find failed: ${failure}`, options);
  }
}

function tagged<T>(failure: ChatFindFailure, operation: Promise<T>): Promise<T> {
  return operation.catch((cause: unknown) => {
    throw cause instanceof ChatFindFailureError
      ? cause
      : new ChatFindFailureError(failure, { cause });
  });
}

export type ChatFindOptions = SearchOptions & { includeFolded?: boolean };

export enum ChatFindPhase {
  Idle = "idle",
  Searching = "searching",
  Loading = "loading",
  Ready = "ready",
  Error = "error",
  Invalid = "invalid",
}

type Snapshot = {
  open: boolean;
  query: string;
  options: ChatFindOptions;
  phase: ChatFindPhase;
  selectedItemId: string | null;
  /** Position across the whole chat: the search scope, not the selected message. */
  occurrence: number;
  count: number;
  failure: ChatFindFailure | null;
};
export type ChatFindSearch = {
  query: string;
  cursor?: number;
  options?: SearchOptions;
};
export type ChatFindReveal = {
  messageId: string;
  query: string;
  options: ChatFindOptions;
  occurrence: number;
  signal: AbortSignal;
};
export interface ChatFindOperations {
  search(input: ChatFindSearch): Promise<AgentTimelineSearchPayload>;
  load(epoch: string, seq: number): Promise<unknown>;
  reveal(input: ChatFindReveal): Promise<{ occurrence: number; count: number }>;
  clear(): void;
}

export class ChatFindModel {
  private operations: ChatFindOperations;
  private optionsSupported: boolean;
  private state: Snapshot = {
    open: false,
    query: "",
    options: {},
    phase: ChatFindPhase.Idle,
    selectedItemId: null,
    occurrence: 0,
    count: 0,
    failure: null,
  };
  private listeners = new Set<() => void>();
  private historyListeners = new Set<() => void>();
  private items: StreamItem[] = [];
  private turnKeysBySeq = new Map<number, string>();
  private expandedTurnKeys: ReadonlySet<string> = new Set();
  private epoch: string | null = null;
  private resultEpoch: string | null = null;
  private locations: Location[] = [];
  private resolved = new Map<Location, Target>();
  private current = -1;
  private inMessage = { occurrence: 0, count: 0 };
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor({
    operations,
    optionsSupported = true,
  }: {
    operations: ChatFindOperations;
    optionsSupported?: boolean;
  }) {
    this.operations = operations;
    this.optionsSupported = optionsSupported;
  }
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<Snapshot>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private cancel() {
    this.abort.abort();
    this.abort = new AbortController();
    clearTimeout(this.timer);
    this.operations.clear();
  }
  readonly open = () => {
    if (this.state.open) return;
    this.publish({ open: true });
    if (this.state.query) this.setQuery(this.state.query);
  };
  readonly close = () => {
    this.cancel();
    this.publish({
      options: {},
      open: false,
      phase: ChatFindPhase.Idle,
      selectedItemId: null,
      count: 0,
      failure: null,
    });
  };
  readonly setOptions = (options: ChatFindOptions) => {
    if (!this.optionsSupported) return;
    this.publish({ options });
    this.setQuery(this.state.query);
  };
  readonly setQuery = (query: string) => {
    this.cancel();
    this.locations = [];
    this.resultEpoch = null;
    this.resolved.clear();
    this.current = -1;
    this.inMessage = { occurrence: 0, count: 0 };
    const hasQuery = Boolean(query.trim());
    this.publish({
      query,
      phase: hasQuery ? ChatFindPhase.Searching : ChatFindPhase.Idle,
      // Keep the message expanded while searching so its render cap cannot shift the viewport.
      selectedItemId: hasQuery ? this.state.selectedItemId : null,
      occurrence: 0,
      count: 0,
      failure: null,
    });
    if (!hasQuery) return;
    try {
      createPhrasePattern({ query, options: this.state.options });
    } catch (error) {
      if (!(error instanceof SearchQueryError)) throw error;
      this.publish({ phase: ChatFindPhase.Invalid });
      return;
    }
    const signal = this.abort.signal;
    this.timer = setTimeout(() => {
      void this.search(signal);
    }, 120);
  };
  readonly retry = () => this.setQuery(this.state.query);
  private fail(error: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    this.cancel();
    this.publish({
      phase: ChatFindPhase.Error,
      selectedItemId: null,
      // Every operation call site is tagged, so an untagged failure is a bug here
      // rather than a known outcome; `connection` is the least misleading thing to
      // say about one, and its copy already asks the reader to check and retry.
      failure: error instanceof ChatFindFailureError ? error.failure : "connection",
    });
  }
  private async search(signal: AbortSignal) {
    try {
      let cursor: number | undefined;
      do {
        const result = await tagged(
          "connection",
          this.operations.search({
            query: this.state.query,
            cursor,
            options: this.optionsSupported ? this.state.options : undefined,
          }),
        );
        if (signal.aborted) return;
        const historyChanged = this.epoch !== null && result.epoch !== this.epoch;
        const searchChanged = this.resultEpoch !== null && result.epoch !== this.resultEpoch;
        if (historyChanged || searchChanged) throw new ChatFindFailureError("historyChanged");
        this.resultEpoch = result.epoch;
        this.locations.push(
          ...result.locations
            .filter((location) => {
              const turnKey = location.turnId ?? this.turnKeysBySeq.get(location.seq);
              const expanded = turnKey !== undefined && this.expandedTurnKeys.has(turnKey);
              return !location.folded || this.state.options.includeFolded || expanded;
            })
            .map((location) => ({
              folded: location.folded,
              turnId: location.turnId,
              seq: location.seq,
              role: location.role,
              // COMPAT(timelineSearchCount): hosts before v0.9.0 send no count; remove after 2027-09-22.
              count: location.count ?? 1,
            })),
        );
        cursor = result.nextCursor ?? undefined;
      } while (cursor !== undefined);
      await this.navigate(0, 1, signal);
    } catch (error) {
      this.fail(error, signal);
    }
  }
  updateHistory({
    epoch,
    items,
    expandedTurnKeys = this.expandedTurnKeys,
  }: {
    epoch: string | null;
    items: StreamItem[];
    expandedTurnKeys?: ReadonlySet<string>;
  }) {
    const expansionChanged = this.expandedTurnKeys !== expandedTurnKeys;
    this.expandedTurnKeys = expandedTurnKeys;
    if (
      this.resultEpoch !== null &&
      epoch !== null &&
      epoch !== this.resultEpoch &&
      this.state.open
    ) {
      this.fail(new ChatFindFailureError("historyChanged"), this.abort.signal);
    }
    this.epoch = epoch;
    if (this.items !== items) {
      this.turnKeysBySeq.clear();
      for (const turn of completedTurnFolds({ items, getMessageId: (item) => item.id })) {
        const first = turn.items[0]!;
        const turnKey = first.turnId ?? first.id;
        for (const item of turn.items) {
          if (item.timelineCursor) this.turnKeysBySeq.set(item.timelineCursor.seq, turnKey);
        }
      }
    }
    this.items = items;
    this.historyListeners.forEach((listener) => listener());
    if (
      expansionChanged &&
      this.state.open &&
      this.state.phase === ChatFindPhase.Ready &&
      !this.state.options.includeFolded
    ) {
      this.setQuery(this.state.query);
    }
  }
  private target(location: Location, exact: boolean): Target | null {
    let before = 0;
    for (const item of this.items) {
      if (item.timelineCursor?.epoch !== this.resultEpoch) continue;
      const seq = item.timelineCursor.seq;
      if (seq < location.seq) {
        before = Math.max(before, seq);
        continue;
      }
      const sameRole = item.kind === `${location.role}_message`;
      if (sameRole && (!exact || seq === location.seq)) return { id: item.id, seq, before };
      // A prompt is a hard boundary; never resolve an assistant hit in a later response.
      if (item.kind === "user_message") return null;
    }
    return null;
  }
  private waitForTarget(location: Location, signal: AbortSignal): Promise<Target> {
    return new Promise((resolve, reject) => {
      const finish = (target?: Target) => {
        clearTimeout(timeout);
        this.historyListeners.delete(check);
        signal.removeEventListener("abort", cancelled);
        if (target) resolve(target);
        else reject(new ChatFindFailureError("reveal"));
      };
      const check = () => {
        const target = this.target(location, false);
        if (target) finish(target);
      };
      const cancelled = () => finish();
      const timeout = setTimeout(() => finish(), 5000);
      this.historyListeners.add(check);
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
      else check();
    });
  }
  private async navigate(index: number, direction: 1 | -1, signal: AbortSignal) {
    const epoch = this.resultEpoch;
    if (epoch === null) return;
    this.publish({ phase: ChatFindPhase.Loading, failure: null });
    let remaining = this.locations.length;
    while (remaining-- > 0 && this.locations.length) {
      index = (index + this.locations.length) % this.locations.length;
      const location = this.locations[index]!;
      const cached = this.resolved.get(location);
      const stillLoaded =
        cached &&
        this.items.some((item) => item.id === cached.id && item.timelineCursor?.seq === cached.seq);
      let target = stillLoaded ? cached : this.target(location, true);
      if (!target) {
        await tagged("connection", this.operations.load(epoch, location.seq));
        if (signal.aborted) return;
        target = await this.waitForTarget(location, signal);
      }
      if (signal.aborted) return;
      this.resolved.set(location, target);
      // Multiple source hits may belong to the same displayed message. Resolve that
      // here, using loaded client rows, without changing the timeline's data model.
      this.locations = this.locations.filter(
        (candidate) =>
          candidate === location ||
          candidate.role !== location.role ||
          candidate.seq <= target.before ||
          candidate.seq > target.seq,
      );
      index = this.locations.indexOf(location);
      this.publish({ selectedItemId: target.id });
      const result = await tagged(
        "reveal",
        this.operations.reveal({
          messageId: target.id,
          query: this.state.query,
          options: this.state.options,
          occurrence: direction === 1 ? 0 : -1,
          signal,
        }),
      );
      if (signal.aborted) return;
      if (result.count) {
        this.current = index;
        this.publish({ phase: ChatFindPhase.Ready, ...this.position(location, result) });
        return;
      }
      this.locations.splice(index, 1);
      if (direction === -1) index--;
    }
    this.operations.clear();
    this.publish({ phase: ChatFindPhase.Ready, selectedItemId: null, count: 0, occurrence: 0 });
  }
  private position(location: Location, revealed: { occurrence: number; count: number }) {
    this.inMessage = revealed;
    location.count = revealed.count;
    let before = 0;
    let total = 0;
    for (const candidate of this.locations) {
      if (candidate === location) before = total;
      total += candidate.count;
    }
    return { occurrence: before + revealed.occurrence, count: total };
  }
  private async move(direction: 1 | -1) {
    if (this.state.phase !== ChatFindPhase.Ready || !this.state.count) return;
    this.cancel();
    const signal = this.abort.signal;
    try {
      const occurrence = this.inMessage.occurrence + direction;
      if (occurrence >= 0 && occurrence < this.inMessage.count && this.state.selectedItemId) {
        this.publish({ phase: ChatFindPhase.Loading });
        const result = await tagged(
          "reveal",
          this.operations.reveal({
            messageId: this.state.selectedItemId,
            query: this.state.query,
            options: this.state.options,
            occurrence,
            signal,
          }),
        );
        if (signal.aborted) return;
        if (result.count) {
          this.publish({
            phase: ChatFindPhase.Ready,
            ...this.position(this.locations[this.current]!, result),
          });
          return;
        }
      }
      await this.navigate(this.current + direction, direction, signal);
    } catch (error) {
      this.fail(error, signal);
    }
  }
  readonly next = () => {
    void this.move(1);
  };
  readonly previous = () => {
    void this.move(-1);
  };
}
