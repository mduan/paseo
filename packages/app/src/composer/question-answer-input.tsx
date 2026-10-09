import { useCallback, useMemo, useEffect, useState, type ComponentProps } from "react";
import { createStore } from "zustand/vanilla";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { Composer } from "@/composer";
import { ComposerInputMode } from "./input-mode";

type QuestionAnswerInputProps = Pick<
  ComponentProps<typeof Composer>,
  | "serverId"
  | "agentId"
  | "workspaceId"
  | "cwd"
  | "attachments"
  | "onChangeAttachments"
  | "onBusyChange"
  | "isSubmitDisabled"
  | "submitLabel"
  | "placeholder"
> & {
  value: string;
  replacementKey: string;
  accessibilityLabel: string;
  isResponding: boolean;
  hasAnswer: boolean;
  onChange: (text: string) => void;
  onSubmit: () => Promise<void>;
};

function noop() {}

export function QuestionAnswerInput({ value, onChange, ...props }: QuestionAnswerInputProps) {
  const [text] = useState(() => createStore(() => value));
  useEffect(() => text.setState(value), [value, text]);
  const onChangeText = useCallback(
    (nextValue: string) => {
      text.setState(nextValue);
      onChange(nextValue);
    },
    [onChange, text],
  );
  const textSource = useMemo(
    () => ({ getSnapshot: text.getState, subscribe: text.subscribe }),
    [text],
  );

  const textReplacement = useMemo(
    () => ({ key: props.replacementKey, text: value }),
    [props.replacementKey, value],
  );

  return (
    <FileDropZone disabled={props.isResponding}>
      <Composer
        serverId={props.serverId}
        agentId={props.agentId}
        workspaceId={props.workspaceId}
        cwd={props.cwd}
        attachments={props.attachments}
        onChangeAttachments={props.onChangeAttachments}
        onBusyChange={props.onBusyChange}
        isSubmitDisabled={props.isSubmitDisabled}
        submitLabel={props.submitLabel}
        placeholder={props.placeholder}
        isPaneFocused={false}
        inputMode={ComposerInputMode.Question}
        inputAccessibilityLabel={props.accessibilityLabel}
        textSource={textSource}
        onChangeText={onChangeText}
        textReplacement={textReplacement}
        onSubmitMessage={props.onSubmit}
        submitBehavior="preserve-and-lock"
        isSubmitLoading={props.isResponding}
        hasExternalContent={props.hasAnswer}
        allowEmptySubmit
        submitButtonAccessibilityLabel={props.submitLabel}
        submitButtonTestID="question-form-primary-action"
        clearDraft={noop}
      />
    </FileDropZone>
  );
}
