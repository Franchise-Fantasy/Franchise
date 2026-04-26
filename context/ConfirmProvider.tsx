/**
 * Imperative API for the brand-styled dialog primitives — `InlineConfirm`,
 * `InlineAction`, `InlineInput`. Replaces the old `ConfirmProvider`/`ConfirmModal`
 * pair (which used native `<Modal>` and broke on iOS when stacked inside
 * another modal).
 *
 * Three hooks:
 *
 *   const confirm     = useConfirm();
 *   const pickAction  = useActionPicker();
 *   const promptInput = useTextPrompt();
 *
 * All three open a brand-chromed overlay. Mechanically these are plain
 * absolute-positioned overlays (no `<Modal>`), routed through a host
 * stack so the dialog always renders inside the topmost active modal —
 * no native stacking, no scrim collision, no frozen-touch state.
 *
 * Hosting:
 *   - The provider mounts a default `RootDialogHost` near the app root.
 *   - Any `<Modal>` that wants to host dialogs renders `<DialogHost />`
 *     once inside its content. On mount it registers; on unmount it
 *     unregisters. Only the topmost registered host renders the overlay.
 *   - The `BottomSheet` primitive embeds `<DialogHost />`, so every
 *     bottom-sheet consumer hosts dialogs automatically.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { InlineAction, type ActionConfig } from '@/components/ui/InlineAction';
import { InlineConfirm, type ConfirmConfig } from '@/components/ui/InlineConfirm';
import { InlineInput, type InputConfig } from '@/components/ui/InlineInput';

type ConfirmFn = (config: ConfirmConfig) => void;
type ActionFn = (config: ActionConfig) => void;
type InputFn = (config: InputConfig) => void;

interface InternalCtx {
  // Public hooks
  confirm: ConfirmFn;
  pickAction: ActionFn;
  promptInput: InputFn;
  // Host registry (used by DialogHost)
  registerHost: (id: string) => void;
  unregisterHost: (id: string) => void;
  topHostId: string | null;
  // Render state (used by DialogRenderer)
  confirmState: ConfirmConfig | null;
  setConfirmState: (next: ConfirmConfig | null) => void;
  actionState: ActionConfig | null;
  setActionState: (next: ActionConfig | null) => void;
  inputState: InputConfig | null;
  setInputState: (next: InputConfig | null) => void;
}

const noop = () => {
  /* default value when not inside a provider */
};

const DialogContext = createContext<InternalCtx>({
  confirm: noop,
  pickAction: noop,
  promptInput: noop,
  registerHost: noop,
  unregisterHost: noop,
  topHostId: null,
  confirmState: null,
  setConfirmState: noop,
  actionState: null,
  setActionState: noop,
  inputState: null,
  setInputState: noop,
});

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmConfig | null>(null);
  const [actionState, setActionState] = useState<ActionConfig | null>(null);
  const [inputState, setInputState] = useState<InputConfig | null>(null);
  const [hostStack, setHostStack] = useState<string[]>([]);

  const registerHost = useCallback((id: string) => {
    setHostStack((prev) => [...prev, id]);
  }, []);

  const unregisterHost = useCallback((id: string) => {
    setHostStack((prev) => prev.filter((x) => x !== id));
  }, []);

  const topHostId = hostStack.length > 0 ? hostStack[hostStack.length - 1]! : null;

  const confirm = useCallback<ConfirmFn>((next) => setConfirmState(next), []);
  const pickAction = useCallback<ActionFn>((next) => setActionState(next), []);
  const promptInput = useCallback<InputFn>((next) => setInputState(next), []);

  const value = useMemo<InternalCtx>(
    () => ({
      confirm,
      pickAction,
      promptInput,
      registerHost,
      unregisterHost,
      topHostId,
      confirmState,
      setConfirmState,
      actionState,
      setActionState,
      inputState,
      setInputState,
    }),
    [
      confirm,
      pickAction,
      promptInput,
      registerHost,
      unregisterHost,
      topHostId,
      confirmState,
      actionState,
      inputState,
    ],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      <RootDialogHost />
    </DialogContext.Provider>
  );
}

/**
 * Public hook — open a Cancel/Action confirm dialog. Same signature as
 * the old `useConfirm()`.
 */
export function useConfirm(): ConfirmFn {
  return useContext(DialogContext).confirm;
}

/**
 * Public hook — open a list-of-actions picker (replaces ActionSheetIOS).
 */
export function useActionPicker(): ActionFn {
  return useContext(DialogContext).pickAction;
}

/**
 * Public hook — open a single-text-input prompt (replaces Alert.prompt).
 */
export function useTextPrompt(): InputFn {
  return useContext(DialogContext).promptInput;
}

/**
 * Mount inside any `<Modal>` that wants to host dialogs so the overlay
 * renders inside the modal's tree (above its content) instead of behind
 * it at the app root. Idempotent — re-mounting just re-registers.
 */
export function DialogHost() {
  const ctx = useContext(DialogContext);
  const id = useId();
  const idRef = useRef(id);

  useEffect(() => {
    const current = idRef.current;
    ctx.registerHost(current);
    return () => ctx.unregisterHost(current);
    // ctx is stable from useMemo; we only want this on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ctx.topHostId !== idRef.current) return null;
  return <DialogRenderer />;
}

/** Default host rendered at app root — only fires when no other host is active. */
function RootDialogHost() {
  const ctx = useContext(DialogContext);
  if (ctx.topHostId !== null) return null;
  return <DialogRenderer />;
}

/** Renders whichever dialog state slots are non-null. */
function DialogRenderer() {
  const {
    confirmState,
    setConfirmState,
    actionState,
    setActionState,
    inputState,
    setInputState,
  } = useContext(DialogContext);

  return (
    <>
      {confirmState ? (
        <InlineConfirm
          config={confirmState}
          onClose={() => setConfirmState(null)}
        />
      ) : null}
      {actionState ? (
        <InlineAction
          config={actionState}
          onClose={() => setActionState(null)}
        />
      ) : null}
      {inputState ? (
        <InlineInput
          config={inputState}
          onClose={() => setInputState(null)}
        />
      ) : null}
    </>
  );
}
