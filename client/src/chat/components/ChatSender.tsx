import { Sender } from "@ant-design/x";
import { useEffect, useRef, useState } from "react";

const COMPOSER_PLACEHOLDERS = [
  "问问题，尽管问",
  "写一个需求，我帮你梳理",
  "描述你的任务，我来协助拆解",
  "贴一段代码，我帮你分析",
  "告诉我目标，我帮你推进",
];

const PLACEHOLDER_ANIMATION_MS = 460;
const PLACEHOLDER_ROTATE_INTERVAL_MS = 4200;

function pickRandomPlaceholderIndex(exclude: number): number {
  if (COMPOSER_PLACEHOLDERS.length <= 1) return 0;
  let next = exclude;
  while (next === exclude) {
    next = Math.floor(Math.random() * COMPOSER_PLACEHOLDERS.length);
  }
  return next;
}

interface ChatSenderProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  loading: boolean;
  empty?: boolean;
}

export default function ChatSender({
  value,
  onChange,
  onSubmit,
  onCancel,
  loading,
  empty = false,
}: ChatSenderProps) {
  const [composerPlaceholderIndex, setComposerPlaceholderIndex] = useState(0);
  const [nextPlaceholderIndex, setNextPlaceholderIndex] = useState<number | null>(null);
  const [placeholderAnimating, setPlaceholderAnimating] = useState(false);
  const placeholderTimerRef = useRef<number | null>(null);
  const placeholderIndexRef = useRef(0);
  const showAnimatedPlaceholder = !value.trim();

  useEffect(() => {
    placeholderIndexRef.current = composerPlaceholderIndex;
  }, [composerPlaceholderIndex]);

  useEffect(() => {
    if (value.trim()) {
      setNextPlaceholderIndex(null);
      setPlaceholderAnimating(false);
      if (placeholderTimerRef.current !== null) {
        window.clearTimeout(placeholderTimerRef.current);
        placeholderTimerRef.current = null;
      }
      return;
    }

    const timer = window.setInterval(() => {
      if (placeholderTimerRef.current !== null) return;

      const nextIndex = pickRandomPlaceholderIndex(placeholderIndexRef.current);
      setNextPlaceholderIndex(nextIndex);
      setPlaceholderAnimating(true);

      placeholderTimerRef.current = window.setTimeout(() => {
        setComposerPlaceholderIndex(nextIndex);
        setNextPlaceholderIndex(null);
        setPlaceholderAnimating(false);
        placeholderTimerRef.current = null;
      }, PLACEHOLDER_ANIMATION_MS);
    }, PLACEHOLDER_ROTATE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      if (placeholderTimerRef.current !== null) {
        window.clearTimeout(placeholderTimerRef.current);
        placeholderTimerRef.current = null;
      }
    };
  }, [value]);

  return (
    <div className={`app-composer-shell ${empty ? "app-composer-shell-empty" : ""}`}>
      <div className="app-composer">
        {showAnimatedPlaceholder ? (
          <div
            className={`app-placeholder-rotator ${empty ? "app-placeholder-rotator-empty" : ""}`}
            aria-hidden="true"
          >
            <div className={`app-placeholder-track ${placeholderAnimating ? "is-animating" : ""}`}>
              <span className="app-placeholder-text">{COMPOSER_PLACEHOLDERS[composerPlaceholderIndex]}</span>
              {nextPlaceholderIndex !== null ? (
                <span className="app-placeholder-text">{COMPOSER_PLACEHOLDERS[nextPlaceholderIndex]}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        <Sender
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          loading={loading}
          placeholder=""
          submitType="enter"
          autoSize={empty ? { minRows: 3, maxRows: 8 } : { minRows: 1, maxRows: 8 }}
          className={`app-x-sender ${empty ? "app-x-sender-empty" : ""}`}
          classNames={{
            input: `app-x-sender-input ${empty ? "app-x-sender-input-empty" : ""}`.trim(),
            content: `app-x-sender-content ${empty ? "app-x-sender-content-empty" : ""}`.trim(),
            suffix: "app-x-sender-suffix",
          }}
        />
      </div>
    </div>
  );
}
