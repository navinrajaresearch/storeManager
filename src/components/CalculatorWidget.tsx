import { useState } from "react";
import { motion } from "framer-motion";

type Op = "+" | "-" | "×" | "÷" | null;

export function CalculatorWidget() {
  const [display, setDisplay]   = useState("0");
  const [operand, setOperand]   = useState<number | null>(null);
  const [op, setOp]             = useState<Op>(null);
  const [fresh, setFresh]       = useState(false); // next digit replaces display

  function pressDigit(d: string) {
    if (fresh) {
      setDisplay(d === "." ? "0." : d);
      setFresh(false);
    } else {
      if (d === "." && display.includes(".")) return;
      setDisplay(display === "0" && d !== "." ? d : display + d);
    }
  }

  function pressOp(next: Op) {
    const cur = parseFloat(display);
    if (operand !== null && op && !fresh) {
      const result = compute(operand, op, cur);
      setDisplay(fmt(result));
      setOperand(result);
    } else {
      setOperand(cur);
    }
    setOp(next);
    setFresh(true);
  }

  function pressEqual() {
    if (operand === null || op === null) return;
    const cur = parseFloat(display);
    const result = compute(operand, op, cur);
    setDisplay(fmt(result));
    setOperand(null);
    setOp(null);
    setFresh(true);
  }

  function pressClear() {
    setDisplay("0");
    setOperand(null);
    setOp(null);
    setFresh(false);
  }

  function pressBackspace() {
    if (fresh || display.length <= 1) {
      setDisplay("0");
      setFresh(false);
    } else {
      setDisplay(display.slice(0, -1));
    }
  }

  function compute(a: number, o: Op, b: number): number {
    switch (o) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? 0 : a / b;
      default:  return b;
    }
  }

  function fmt(n: number): string {
    if (!isFinite(n)) return "Error";
    const s = parseFloat(n.toPrecision(10)).toString();
    return s;
  }

  const btn = (
    label: string,
    onClick: () => void,
    variant: "digit" | "op" | "eq" | "util" = "digit",
    active = false
  ) => (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className={[
        "rounded-xl font-medium text-sm h-10 w-full transition-colors select-none",
        variant === "digit" && "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
        variant === "op"    && (active
          ? "bg-sky-500 text-white border border-sky-500"
          : "bg-sky-50 border border-sky-200 text-sky-600 hover:bg-sky-100"),
        variant === "eq"    && "bg-sky-500 text-white hover:bg-sky-600 border border-sky-500",
        variant === "util"  && "bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200",
      ].filter(Boolean).join(" ")}
    >
      {label}
    </motion.button>
  );

  const displayOverflows = display.length > 12;

  return (
    <div className="w-56 select-none">
      {/* Display */}
      <div className="bg-slate-800 rounded-xl px-4 py-3 mb-3 text-right">
        {op && operand !== null && (
          <div className="text-slate-400 text-xs mb-0.5">
            {fmt(operand)} {op}
          </div>
        )}
        <div className={`text-white font-mono font-semibold leading-none ${displayOverflows ? "text-base" : "text-2xl"}`}>
          {display}
        </div>
      </div>

      {/* Buttons — 4 cols */}
      <div className="grid grid-cols-4 gap-1.5">
        {btn("C",   pressClear,     "util")}
        {btn("⌫",   pressBackspace, "util")}
        {btn("",    () => {},        "util")}  {/* spacer */}
        {btn("÷",   () => pressOp("÷"), "op", op === "÷" && !fresh)}

        {btn("7", () => pressDigit("7"))}
        {btn("8", () => pressDigit("8"))}
        {btn("9", () => pressDigit("9"))}
        {btn("×", () => pressOp("×"), "op", op === "×" && !fresh)}

        {btn("4", () => pressDigit("4"))}
        {btn("5", () => pressDigit("5"))}
        {btn("6", () => pressDigit("6"))}
        {btn("−", () => pressOp("-"), "op", op === "-" && !fresh)}

        {btn("1", () => pressDigit("1"))}
        {btn("2", () => pressDigit("2"))}
        {btn("3", () => pressDigit("3"))}
        {btn("+", () => pressOp("+"), "op", op === "+" && !fresh)}

        <div className="col-span-2">
          {btn("0", () => pressDigit("0"))}
        </div>
        {btn(".", () => pressDigit("."))}
        {btn("=", pressEqual, "eq")}
      </div>
    </div>
  );
}
