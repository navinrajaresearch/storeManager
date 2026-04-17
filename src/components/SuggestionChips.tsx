import { motion } from "framer-motion";
import { SUGGESTION_CHIPS } from "../types";
import { playTick } from "../utils/sound";

interface Props { onSelect: (cmd: string) => void; disabled?: boolean; }

export function SuggestionChips({ onSelect, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SUGGESTION_CHIPS.map((chip, i) => (
        <motion.button key={chip.cmd} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          disabled={disabled}
          onClick={() => { playTick(); onSelect(chip.cmd); }}
          className="px-3 py-1.5 text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200 hover:border-sky-300 disabled:opacity-40 rounded-full shadow-sm transition-all">
          {chip.label}
        </motion.button>
      ))}
    </div>
  );
}
