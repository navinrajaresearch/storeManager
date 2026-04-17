import { motion } from "framer-motion";

/**
 * Animates the letters N and R being drawn stroke-by-stroke, holds,
 * then erases — loops forever. Used as the chat loading indicator.
 */

const TOTAL = 3; // seconds per cycle

/** Build the animate object for one path given its draw window (in seconds). */
function ink(drawStart: number, drawEnd: number) {
  return {
    pathLength: [0, 0, 1, 1, 0],
    transition: {
      times: [0, drawStart / TOTAL, drawEnd / TOTAL, 0.87, 1],
      duration: TOTAL,
      repeat: Infinity,
      ease: ["linear", "easeOut", "linear", "easeIn"] as const,
    },
  };
}

export function BrandLoader() {
  return (
    <svg
      viewBox="0 0 28 18"
      width="48"
      height="30"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* ── N ────────────────────────────────── */}
      {/* left vertical */}
      <motion.path
        d="M 1,16 L 1,2"
        stroke="#6366f1"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={ink(0, 0.3)}
      />
      {/* diagonal */}
      <motion.path
        d="M 1,2 L 11,16"
        stroke="#6366f1"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={ink(0.25, 0.65)}
      />
      {/* right vertical */}
      <motion.path
        d="M 11,2 L 11,16"
        stroke="#6366f1"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={ink(0.6, 0.9)}
      />

      {/* ── R ────────────────────────────────── */}
      {/* vertical stem + bump */}
      <motion.path
        d="M 16,16 L 16,2 L 22,2 Q 27,2 27,6 Q 27,10 22,10 L 16,10"
        stroke="#818cf8"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={ink(0.85, 1.65)}
      />
      {/* diagonal leg */}
      <motion.path
        d="M 22,10 L 27,16"
        stroke="#818cf8"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={ink(1.6, 1.9)}
      />
    </svg>
  );
}
