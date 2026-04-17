import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { COMMAND_TEMPLATES } from "../types";
import { playClick } from "../utils/sound";

interface Props {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = value.trim()
    ? COMMAND_TEMPLATES.filter((c) =>
        c.startsWith(value.toLowerCase()) && c !== value.toLowerCase()
      )
    : [];

  function submit(v = value) {
    const t = v.trim();
    if (!t || disabled) return;
    playClick();
    onSubmit(t);
    setValue("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Tab" && suggestions.length) {
      e.preventDefault();
      setValue(suggestions[0]);
    }
    if (e.key === "Escape") { setValue(""); inputRef.current?.blur(); }
  }

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="relative">
      {/* Autocomplete dropdown */}
      <AnimatePresence>
        {focused && suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-amber-100 rounded-xl overflow-hidden shadow-lg shadow-amber-100/50 z-10"
          >
            {suggestions.slice(0, 5).map((s) => (
              <li key={s}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); setValue(s); submit(s); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-amber-50 hover:text-gray-900 transition-colors"
                >
                  {s}
                </button>
              </li>
            ))}
            <li className="px-4 py-1.5 text-[10px] text-gray-400 border-t border-amber-50">
              Tab to autocomplete
            </li>
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Input row */}
      <div
        className={`flex items-center gap-2 bg-white border rounded-2xl px-4 py-3 transition-all ${
          focused ? "border-orange-400 ring-2 ring-orange-100" : "border-amber-200"
        }`}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Type a command… (try 'help')"
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50 selectable"
        />
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => submit()}
          disabled={!value.trim() || disabled}
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 hover:from-orange-500 hover:to-amber-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all"
        >
          <ArrowUp className="w-4 h-4 text-white" />
        </motion.button>
      </div>
    </div>
  );
}
