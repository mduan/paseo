import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useState, useCallback, useMemo, useEffect } from "react";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { PendingPermission } from "@/types/shared";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { UserComposerAttachment } from "@/attachments/types";
import { getAttachmentStore } from "@/attachments/store";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { buildQuestionAttachmentAnswer } from "@/composer/question-answer";
import { QuestionAnswerInput } from "@/composer/question-answer-input";
import {
  buildQuestionFormAnswers,
  isQuestionAnswered,
  parseQuestionFormQuestions,
  resolveDismissLabel,
  resolveQuestionFormState,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOption,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void | Promise<unknown>;
  serverId: string;
  workspaceId?: string;
  cwd: string;
  client: DaemonClient | null;
  isResponding: boolean;
}

const EMPTY_ATTACHMENTS: UserComposerAttachment[] = [];

function getQuestionInputPlaceholder({
  question,
  answerPlaceholder,
  otherPlaceholder,
}: {
  question: QuestionFormQuestion;
  answerPlaceholder: string;
  otherPlaceholder: string;
}): string {
  return (
    question.placeholder ?? (question.options.length === 0 ? answerPlaceholder : otherPlaceholder)
  );
}

interface QuestionOptionRowProps {
  qIndex: number;
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}

function QuestionOptionRow({
  qIndex,
  optIndex,
  option,
  isSelected,
  multiSelect,
  isResponding,
  onToggle,
}: QuestionOptionRowProps) {
  const { theme } = useUnistyles();

  const handlePress = useCallback(() => {
    onToggle(qIndex, optIndex, multiSelect);
  }, [onToggle, qIndex, optIndex, multiSelect]);

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionItem,
      (Boolean(hovered) || isSelected) && {
        backgroundColor: theme.colors.surface2,
      },
      pressed && styles.optionItemPressed,
    ],
    [isSelected, theme.colors.surface2],
  );

  const optionLabelStyle = useMemo(
    () => [
      styles.optionLabel,
      { color: isSelected ? theme.colors.foreground : theme.colors.foregroundMuted },
    ],
    [isSelected, theme.colors.foreground, theme.colors.foregroundMuted],
  );
  const optionDescriptionStyle = useMemo(
    () => [styles.optionDescription, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const accessibilityState = useMemo(() => ({ checked: isSelected }), [isSelected]);

  // Static left-side control: square for multi-select, circle for single-select.
  // Always rendered so toggling only swaps fill/border — the row never reflows.
  const controlStyle = useMemo(
    () => [
      styles.selectionControl,
      multiSelect ? styles.selectionControlCheckbox : styles.selectionControlRadio,
      {
        borderColor: isSelected ? theme.colors.accent : theme.colors.foregroundExtraMuted,
        backgroundColor: isSelected && multiSelect ? theme.colors.accent : "transparent",
      },
    ],
    [isSelected, multiSelect, theme.colors.accent, theme.colors.foregroundExtraMuted],
  );
  const radioDotStyle = useMemo(
    () => [styles.selectionRadioDot, { backgroundColor: theme.colors.accent }],
    [theme.colors.accent],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
      accessibilityRole={multiSelect ? "checkbox" : "radio"}
      accessibilityLabel={option.label}
      accessibilityState={accessibilityState}
      aria-checked={isSelected}
    >
      <View style={styles.optionItemContent}>
        <View style={controlStyle}>
          {isSelected && multiSelect ? (
            <Check size={12} color={theme.colors.accentForeground} />
          ) : null}
          {isSelected && !multiSelect ? <View style={radioDotStyle} /> : null}
        </View>
        <View style={styles.optionTextBlock}>
          <Text style={optionLabelStyle}>{option.label}</Text>
          {option.description ? (
            <Text style={optionDescriptionStyle}>{option.description}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

interface QuestionNavButtonProps {
  index: number;
  total: number;
  header: string;
  isActive: boolean;
  isAnswered: boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

function QuestionNavButton({
  index,
  total,
  header,
  isActive,
  isAnswered,
  isResponding,
  onSelect,
}: QuestionNavButtonProps) {
  const { theme } = useUnistyles();
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const handlePress = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);
  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      return [
        styles.questionNavButton,
        {
          backgroundColor:
            isActive || Boolean(hovered) ? theme.colors.surface2 : theme.colors.surface1,
          borderColor: isActive ? theme.colors.foregroundMuted : theme.colors.border,
        },
        pressed && styles.optionItemPressed,
      ];
    },
    [
      isActive,
      theme.colors.border,
      theme.colors.foregroundMuted,
      theme.colors.surface1,
      theme.colors.surface2,
    ],
  );
  const textStyle = useMemo(
    () => [
      styles.questionNavText,
      { color: isActive ? theme.colors.foreground : theme.colors.foregroundMuted },
    ],
    [isActive, theme.colors.foreground, theme.colors.foregroundMuted],
  );

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`Question ${index + 1} of ${total}`}
      accessibilityState={accessibilityState}
      aria-selected={isActive}
      testID={`question-form-question-nav-${index + 1}`}
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
    >
      {isAnswered ? (
        <Check
          size={12}
          color={isActive ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text style={textStyle} numberOfLines={1}>
        {header}
      </Text>
    </Pressable>
  );
}

interface QuestionNavProps {
  questions: QuestionFormQuestion[];
  activeIndex: number;
  isAnswered: (qIndex: number) => boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

// Titled tabs (one per question header) with a check on answered ones. Hidden for
// a lone question — a single "1 of 1" tab carries no information.
function QuestionNav({
  questions,
  activeIndex,
  isAnswered,
  isResponding,
  onSelect,
}: QuestionNavProps) {
  if (questions.length <= 1) {
    return null;
  }
  return (
    <View
      style={styles.questionNav}
      testID="question-form-question-nav"
      accessibilityRole="tablist"
    >
      {questions.map((question, qIndex) => (
        <QuestionNavButton
          key={question.header}
          index={qIndex}
          total={questions.length}
          header={question.header}
          isActive={qIndex === activeIndex}
          isAnswered={isAnswered(qIndex)}
          isResponding={isResponding}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

export function QuestionFormCard({
  permission,
  onRespond,
  isResponding,
  serverId,
  workspaceId,
  cwd,
  client,
}: QuestionFormCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );

  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [attachments, setAttachments] = useState<Record<number, UserComposerAttachment[]>>({});
  const [replacementVersion, setReplacementVersion] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInputBusy, setIsInputBusy] = useState(false);
  const [responseError, setError] = useState<string>();
  const isLocked = isResponding || isSubmitting || isInputBusy;
  useEffect(() => {
    const releases = Object.values(attachments).flatMap((items) =>
      items.flatMap((item) =>
        item.kind === "image" ? [retainAttachmentForGarbageCollection(item.metadata.id)] : [],
      ),
    );
    return () => releases.forEach((release) => release());
  }, [attachments]);
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const toggleOption = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      const current = selections[qIndex] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIndex)) {
          next.delete(optIndex);
        } else {
          next.add(optIndex);
        }
      } else if (next.has(optIndex)) {
        next.clear();
      } else {
        next.clear();
        next.add(optIndex);
      }

      setSelections((prev) => ({ ...prev, [qIndex]: next }));

      // Single-select: an option and a custom answer replace each other, as in Claude Code.
      // Multi-select keeps both. The editing surface owns its text and never replays state
      // (docs/forms.md), so clearing state alone would leave stale text on screen that
      // submit ignores; clear the surface explicitly.
      if (!multiSelect && otherTexts[qIndex]) {
        setOtherTexts((prev) => {
          const nextTexts = { ...prev };
          delete nextTexts[qIndex];
          return nextTexts;
        });
        setReplacementVersion((version) => version + 1);
      }

      if (!multiSelect && next.size > 0 && qIndex === activeQuestionIndex && questions) {
        setActiveQuestionIndex(Math.min(qIndex + 1, questions.length - 1));
      }
    },
    [activeQuestionIndex, otherTexts, questions, selections],
  );

  const setOtherText = useCallback(
    (qIndex: number, text: string) => {
      setOtherTexts((prev) => ({ ...prev, [qIndex]: text }));
      const multiSelect = questions?.[qIndex]?.multiSelect ?? false;
      if (!multiSelect && text.length > 0) {
        setSelections((prev) => {
          if (!prev[qIndex] || prev[qIndex].size === 0) return prev;
          return { ...prev, [qIndex]: new Set<number>() };
        });
      }
    },
    [questions],
  );

  const {
    allAnswered,
    resolvedActiveQuestionIndex,
    activeQuestion,
    activeQuestionAnswered,
    isLastQuestion,
    showTextInput,
    primaryAnswered,
  } = resolveQuestionFormState({
    questions,
    selections,
    otherTexts,
    attachments,
    activeQuestionIndex,
  });
  const activeAttachments = attachments[resolvedActiveQuestionIndex] ?? EMPTY_ATTACHMENTS;
  const handleChangeAttachments = useCallback(
    (
      updater:
        | UserComposerAttachment[]
        | ((previous: UserComposerAttachment[]) => UserComposerAttachment[]),
    ) => {
      setAttachments((previous) => ({
        ...previous,
        [resolvedActiveQuestionIndex]:
          typeof updater === "function"
            ? updater(previous[resolvedActiveQuestionIndex] ?? EMPTY_ATTACHMENTS)
            : updater,
      }));
    },
    [resolvedActiveQuestionIndex],
  );
  const handleChangeText = useCallback(
    (text: string) => setOtherText(resolvedActiveQuestionIndex, text),
    [resolvedActiveQuestionIndex, setOtherText],
  );

  const handleSubmit = useCallback(async () => {
    if (!questions || !allAnswered || isLocked) return;
    setIsSubmitting(true);
    setRespondingAction("submit");
    setError(undefined);
    try {
      const answers = buildQuestionFormAnswers(questions, selections, otherTexts);
      for (const [index, question] of questions.entries()) {
        const items = attachments[index];
        if (!items?.length) continue;
        if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
        answers[question.header] = await buildQuestionAttachmentAnswer({
          text: answers[question.header] ?? "",
          attachments: items,
          client,
          store: await getAttachmentStore(),
        });
      }
      await onRespond({
        behavior: "allow",
        updatedInput: { ...permission.request.input, answers },
      });
    } catch (error) {
      if (!showTextInput) setError(error instanceof Error ? error.message : String(error));
      setRespondingAction(null);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    questions,
    allAnswered,
    isLocked,
    selections,
    otherTexts,
    attachments,
    client,
    t,
    onRespond,
    permission.request.input,
    showTextInput,
  ]);

  const handleDeny = useCallback(() => {
    if (!questions || isLocked) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) {
      void Promise.resolve(
        onRespond({
          behavior: "allow",
          updatedInput: {
            ...permission.request.input,
            answers: buildQuestionFormAnswers(questions, selections, otherTexts),
          },
        }),
      ).catch((error) => {
        setError(String(error));
        setRespondingAction(null);
      });
      return;
    }
    void Promise.resolve(
      onRespond({
        behavior: "deny",
        message: "Dismissed by user",
      }),
    ).catch((error) => {
      setError(String(error));
      setRespondingAction(null);
    });
  }, [questions, isLocked, onRespond, otherTexts, permission.request.input, selections]);

  const handleSelectQuestion = useCallback((index: number) => {
    setActiveQuestionIndex(index);
  }, []);

  const navIsAnswered = useCallback(
    (qIndex: number) =>
      questions
        ? isQuestionAnswered(questions[qIndex], qIndex, selections, otherTexts, attachments)
        : false,
    [questions, selections, otherTexts, attachments],
  );

  const handlePrimaryAction = useCallback(async () => {
    if (!isLastQuestion) {
      if (!activeQuestionAnswered || isLocked) return;
      setActiveQuestionIndex((index) => Math.min(index + 1, (questions?.length ?? 1) - 1));
      return;
    }
    await handleSubmit();
  }, [activeQuestionAnswered, handleSubmit, isLastQuestion, isLocked, questions?.length]);

  const handlePrimaryPress = useCallback(() => {
    void handlePrimaryAction().catch(() => {});
  }, [handlePrimaryAction]);

  const dismissButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: theme.colors.borderAccent,
      },
      pressed && styles.optionItemPressed,
    ],
    [theme.colors.surface2, theme.colors.surface1, theme.colors.borderAccent],
  );

  const primaryDisabled = isLocked || !primaryAnswered;
  const primaryActionLabel = isLastQuestion
    ? t("message.question.submit")
    : t("message.question.next");
  const submitButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
        opacity: primaryDisabled ? 0.5 : 1,
      },
      pressed && !primaryDisabled ? styles.optionItemPressed : null,
    ],
    [primaryDisabled, theme.colors.accent],
  );

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
      },
    ],
    [theme.colors.surface1, theme.colors.border],
  );
  const questionTextStyle = useMemo(
    () => [styles.questionText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  // Single-select radios need a group; checkboxes are valid standalone.
  const optionsGroupAccessibility = useMemo(
    () =>
      activeQuestion && !activeQuestion.multiSelect
        ? ({
            accessibilityRole: "radiogroup",
            accessibilityLabel: activeQuestion.question,
          } as const)
        : {},
    [activeQuestion],
  );
  const actionsContainerStyle = useMemo(
    () => [styles.actionsContainer, !isMobile && styles.actionsContainerDesktop],
    [isMobile],
  );
  const dismissActionTextStyle = useMemo(
    () => [styles.actionText, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const submitActionTextColor = theme.colors.accentForeground;
  const submitActionTextStyle = useMemo(
    () => [styles.actionText, { color: submitActionTextColor }],
    [submitActionTextColor],
  );

  if (!questions) {
    return null;
  }

  const dismissLabel = resolveDismissLabel(questions, t("common.actions.dismiss"));
  const selected = selections[resolvedActiveQuestionIndex] ?? new Set<number>();
  const otherText = otherTexts[resolvedActiveQuestionIndex] ?? "";

  return (
    <View style={containerStyle} testID="question-form-card">
      <QuestionNav
        questions={questions}
        activeIndex={resolvedActiveQuestionIndex}
        isAnswered={navIsAnswered}
        isResponding={isLocked}
        onSelect={handleSelectQuestion}
      />
      <View style={styles.questionHeader}>
        <Text selectable testID="question-form-current-question" style={questionTextStyle}>
          {activeQuestion?.question}
        </Text>
      </View>

      {activeQuestion ? (
        <View key={activeQuestion.question} style={styles.questionBlock}>
          {activeQuestion.options.length > 0 ? (
            <View style={styles.optionsWrap} {...optionsGroupAccessibility}>
              {activeQuestion.options.map((opt, optIndex) => (
                <QuestionOptionRow
                  key={opt.label}
                  qIndex={resolvedActiveQuestionIndex}
                  optIndex={optIndex}
                  option={opt}
                  isSelected={selected.has(optIndex)}
                  multiSelect={activeQuestion.multiSelect}
                  isResponding={isLocked}
                  onToggle={toggleOption}
                />
              ))}
            </View>
          ) : null}
          {showTextInput ? (
            <QuestionAnswerInput
              key={resolvedActiveQuestionIndex}
              serverId={serverId}
              agentId={permission.agentId}
              workspaceId={workspaceId}
              cwd={cwd}
              accessibilityLabel={activeQuestion.question}
              value={otherText}
              replacementKey={String(replacementVersion)}
              attachments={activeAttachments}
              onChange={handleChangeText}
              onChangeAttachments={handleChangeAttachments}
              placeholder={getQuestionInputPlaceholder({
                question: activeQuestion,
                answerPlaceholder: t("message.question.answerPlaceholder"),
                otherPlaceholder: t("message.question.otherPlaceholder"),
              })}
              isResponding={isResponding || isSubmitting}
              isSubmitDisabled={!primaryAnswered}
              hasAnswer={activeQuestionAnswered}
              submitLabel={primaryActionLabel}
              onBusyChange={setIsInputBusy}
              onSubmit={handlePrimaryAction}
            />
          ) : null}
        </View>
      ) : null}

      <View style={actionsContainerStyle}>
        <Pressable
          style={dismissButtonStyle}
          onPress={handleDeny}
          disabled={isLocked}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          testID="question-form-dismiss"
        >
          {respondingAction === "dismiss" ? (
            <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <View style={styles.actionContent}>
              <X size={14} color={theme.colors.foregroundMuted} />
              <Text style={dismissActionTextStyle}>{dismissLabel}</Text>
            </View>
          )}
        </Pressable>

        {!showTextInput ? (
          <Pressable
            style={submitButtonStyle}
            onPress={handlePrimaryPress}
            disabled={primaryDisabled}
            accessibilityRole="button"
            accessibilityLabel={primaryActionLabel}
            testID="question-form-primary-action"
          >
            {respondingAction === "submit" ? (
              <LoadingSpinner size="small" color={theme.colors.accentForeground} />
            ) : (
              <View style={styles.actionContent}>
                <Check size={14} color={submitActionTextColor} />
                <Text style={submitActionTextStyle}>{primaryActionLabel}</Text>
              </View>
            )}
          </Pressable>
        ) : null}
      </View>
      {responseError ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {responseError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[3],
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    flex: 1,
  },
  questionText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 22,
  },
  optionsWrap: {
    gap: theme.spacing[1],
  },
  questionNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  questionNavButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
  },
  questionNavText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionItemPressed: {
    opacity: 0.9,
  },
  optionItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  optionTextBlock: {
    flex: 1,
    gap: theme.spacing[1],
  },
  optionLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 22,
  },
  optionDescription: {
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  selectionControl: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    marginTop: 2, // optical-align 18px control to the 22px label first line
  },
  selectionControlCheckbox: {
    borderRadius: theme.borderRadius.base,
  },
  selectionControlRadio: {
    borderRadius: 999,
  },
  selectionRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  errorText: {
    color: theme.colors.destructive,
  },
  actionsContainer: {
    gap: theme.spacing[2],
  },
  actionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.fontSize.base,
  },
}));
