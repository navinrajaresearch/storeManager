import { motion, AnimatePresence } from "framer-motion";
import { X, Terminal } from "lucide-react";
import { playTick } from "../utils/sound";

interface Section {
  title: string;
  commands: { cmd: string; desc: string }[];
}

const SECTIONS: Section[] = [
  {
    title: "Browsing",
    commands: [
      { cmd: "list products",       desc: "Show all products as flip tiles" },
      { cmd: "show stats",          desc: "Inventory value & buy-sell balance" },
      { cmd: "low stock",           desc: "Items with on-hand qty < 10" },
      { cmd: "expiring",            desc: "Products expiring within 90 days" },
      { cmd: "search [query]",      desc: "Ask whether to search products or employees" },
      { cmd: "search products [query]",  desc: "Filter products by name or brand" },
      { cmd: "search employees [query]", desc: "Filter employees by name" },
    ],
  },
  {
    title: "Sales",
    commands: [
      { cmd: "sold 5 [product]",          desc: "Record 5 units sold" },
      { cmd: "sell 3 units of [product]", desc: "Same as above" },
    ],
  },
  {
    title: "Restocking",
    commands: [
      { cmd: "bought 10 [product]",   desc: "Add 10 units to stock" },
      { cmd: "received 20 [product]", desc: "Same as bought" },
      { cmd: "restock 8 [product]",   desc: "Same as bought" },
    ],
  },
  {
    title: "Set exact values",
    commands: [
      { cmd: "set quantity [product] to 50",        desc: "Set stock to an exact number" },
      { cmd: "set sold [product] to 30",            desc: "Set sold count to an exact number" },
      { cmd: "set sell price [product] to 25",      desc: "Update the selling price" },
      { cmd: "set buy price [product] to 15",       desc: "Update the buying/cost price" },
    ],
  },
  {
    title: "Managing",
    commands: [
      { cmd: "add product",      desc: "Upload a photo — details filled automatically" },
      { cmd: "delete [product]", desc: "Remove a product permanently" },
    ],
  },
  {
    title: "Employees",
    commands: [
      { cmd: "list employees",                desc: "See all staff members" },
      { cmd: "add employee",                  desc: "Add a new team member" },
      { cmd: "check in [name]",               desc: "Record today's attendance" },
      { cmd: "who checked in today",          desc: "See who's in today" },
      { cmd: "who checked in this week",      desc: "Attendance this week" },
      { cmd: "checked in last 7 days",        desc: "Attendance over any period" },
      { cmd: "employee stats",                desc: "Headcount and salary overview" },
      { cmd: "set salary [name] to [amount]",  desc: "Update someone's pay rate" },
      { cmd: "set salary [name] to hourly",   desc: "Switch to hourly pay" },
      { cmd: "set salary [name] to monthly",  desc: "Switch to monthly pay" },
      { cmd: "edit employee [name]",          desc: "Open edit form for an employee" },
      { cmd: "delete employee [name]",        desc: "Remove an employee record" },
    ],
  },
  {
    title: "Reports",
    commands: [
      { cmd: "reports",            desc: "Open the reports menu" },
      { cmd: "inventory report",   desc: "Full stock list with values" },
      { cmd: "product chart",      desc: "Bar chart of stock by product" },
      { cmd: "trending products",  desc: "Best-selling products over last N days" },
      { cmd: "unpopular products", desc: "Slow-moving or never-sold stock" },
      { cmd: "employee report",    desc: "Attendance summary for all staff" },
      { cmd: "salary today",       desc: "Pay owed to employees who checked in today" },
      { cmd: "monthly salary",     desc: "Monthly pay total for all employees" },
      { cmd: "salary report",      desc: "Pay breakdown for a custom date range" },
      { cmd: "company spend",      desc: "Total salary spend across the team" },
    ],
  },
  {
    title: "Other",
    commands: [
      { cmd: "help",    desc: "Show all available commands" },
      { cmd: "readme",  desc: "Open this command reference panel" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (cmd: string) => void;
}

export function ReadmePanel({ open, onClose, onRun }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />

          {/* Drawer — slides in from the right */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="fixed top-0 right-0 h-full w-80 bg-white border-l border-gray-200 z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-500" />
                <span className="font-semibold text-gray-800 text-sm">Command Reference</span>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
              <p className="text-xs text-gray-500 leading-relaxed">
                Click any command to run it in the chat. Placeholders like{" "}
                <code className="bg-indigo-50 text-indigo-600 rounded px-1">[product]</code>{" "}
                will be inserted as-is — edit them before sending.
              </p>

              {SECTIONS.map((section) => (
                <div key={section.title}>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    {section.title}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {section.commands.map(({ cmd, desc }) => (
                      <CommandRow
                        key={cmd}
                        cmd={cmd}
                        desc={desc}
                        onRun={() => {
                          playTick();
                          onRun(cmd);
                          // Close panel only for non-placeholder commands
                          if (!cmd.includes("[")) onClose();
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Tile diagram */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  Tile flip
                </p>
                <div className="bg-gray-50 rounded-xl p-3 font-mono text-[10px] text-gray-500 leading-relaxed whitespace-pre">
{`FRONT          BACK
┌──────────┐   ┌──────────┐
│ [image]  │   │ Brand    │
│          │   │ Name     │
│ brand    │   │ ──────── │
│ name     │   │ On hand  │
│ 🌐 lang  │   │ Sold     │
└──────────┘   │ Buy $    │
               │ Sell $   │
               │ Exp date │
               │ ──────── │
               │ P&L amt  │
               └──────────┘`}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Click any tile to flip it</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200 flex flex-col gap-1">
              <p className="text-[10px] text-gray-500">
                <span className="font-semibold">Export / Import</span> — use the buttons in the top-right header to back up or restore all data.
              </p>
              <p className="text-[10px] text-gray-400 text-center mt-1">
                Store Manager — works fully offline
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Single command row ────────────────────────────────────────────────────────

function CommandRow({
  cmd,
  desc,
  onRun,
}: {
  cmd: string;
  desc: string;
  onRun: () => void;
}) {
  const hasPlaceholder = cmd.includes("[");

  return (
    <motion.button
      whileHover={{ scale: 1.01, x: 2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onRun}
      className="w-full text-left flex items-start gap-2.5 px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <code className="text-xs text-indigo-600 font-mono block truncate">{cmd}</code>
        <p className="text-[10px] text-gray-400 group-hover:text-gray-600 transition-colors mt-0.5">
          {desc}
        </p>
      </div>
      <span className="flex-shrink-0 text-[9px] text-gray-400 group-hover:text-gray-600 transition-colors pt-0.5">
        {hasPlaceholder ? "edit ↗" : "run ↗"}
      </span>
    </motion.button>
  );
}
