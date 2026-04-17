import { useState } from "react";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import type { Employee } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SalaryEntry {
  date: string;
  salary: number;
  salaryType: "monthly" | "hourly";
}

function parseSalaryHistory(raw: string): SalaryEntry[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SalaryEntry[];
  } catch {
    return [];
  }
}

function parseCheckInHistory(raw: string): { date: string; hours: number }[] {
  if (!raw) return [];
  return raw.split(",").filter(Boolean).map((entry) => {
    const colon = entry.indexOf(":");
    if (colon === -1) return { date: entry, hours: 8 };
    return { date: entry.slice(0, colon), hours: parseFloat(entry.slice(colon + 1)) || 8 };
  });
}

/**
 * Return the salary AMOUNT applicable on a given date by looking at history.
 * We deliberately do NOT return salaryType from history — the employee's current
 * salaryType is the authoritative value (history entries may have stale types
 * from before a monthly→hourly switch).
 */
function getSalaryAmountForDate(employee: Employee, date: string): number {
  const history = parseSalaryHistory(employee.salaryHistory);
  if (!history.length) return employee.salary;
  const applicable = history
    .filter((h) => h.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!applicable.length) {
    return [...history].sort((a, b) => a.date.localeCompare(b.date))[0].salary;
  }
  return applicable[0].salary;
}

interface EmployeeResult {
  employee: Employee;
  days: number;
  totalHours: number;
  dailyRate: number;
  total: number;
}

function calcPeriod(
  employees: Employee[],
  startDate: string,
  endDate: string
): EmployeeResult[] {
  return employees
    .map((e) => {
      const history = parseCheckInHistory(e.checkInHistory);
      const entries = history.filter((h) => h.date >= startDate && h.date <= endDate);
      let total = 0;
      let totalHours = 0;
      for (const entry of entries) {
        const salary = getSalaryAmountForDate(e, entry.date);
        if (e.salaryType === "hourly") {
          total += salary * entry.hours;
          totalHours += entry.hours;
        } else {
          total += salary / 30;
        }
      }
      const avgDailyRate = entries.length > 0 ? total / entries.length : 0;
      return { employee: e, days: entries.length, totalHours, dailyRate: avgDailyRate, total };
    })
    .filter((r) => r.days > 0);
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportCsv(results: EmployeeResult[], startDate: string, endDate: string) {
  const header = "Name,Type,Days,Hours,Rate,Total (Rs)";
  const rows = results.map((r) => {
    const isHourly = r.employee.salaryType === "hourly";
    const rate = isHourly
      ? `${r.employee.salary.toFixed(2)}/hr`
      : `${r.dailyRate.toFixed(2)}/day`;
    return `"${r.employee.name}","${r.employee.salaryType}",${r.days},${isHourly ? r.totalHours : "-"},"${rate}",${r.total.toFixed(2)}`;
  });
  const totalPayout = results.reduce((s, r) => s + r.total, 0);
  rows.push(`"TOTAL",,,"${totalPayout.toFixed(2)}"`);
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `salary_${startDate}_to_${endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function shareWhatsApp(results: EmployeeResult[], startDate: string, endDate: string) {
  const totalPayout = results.reduce((s, r) => s + r.total, 0);
  const lines = [
    `*Salary Report: ${startDate} to ${endDate}*`,
    "",
    ...results.map(
      (r) =>
        `• ${r.employee.name}: ${r.days} day${r.days !== 1 ? "s" : ""} — ₹${r.total.toFixed(2)}`
    ),
    "",
    `*Total payout: ₹${totalPayout.toFixed(2)}*`,
  ];
  const text = encodeURIComponent(lines.join("\n"));
  window.open(`https://wa.me/?text=${text}`, "_blank");
}

// ── Component ─────────────────────────────────────────────────────────────────

type ViewState = "picker" | "results";

interface Props {
  employees: Employee[];
}

export function SalaryPeriodWidget({ employees }: Props) {
  const [view, setView] = useState<ViewState>("picker");
  const [lastNDays, setLastNDays] = useState(7);
  const [results, setResults] = useState<EmployeeResult[]>([]);
  const [periodLabel, setPeriodLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function handleToday() {
    const today = new Date().toISOString().slice(0, 10);
    const res = calcPeriod(employees, today, today);
    setResults(res);
    setPeriodLabel(`Today (${today})`);
    setStartDate(today);
    setEndDate(today);
    setView("results");
  }

  function handleLastN() {
    const n = Math.max(1, Math.min(30, lastNDays));
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - (n - 1) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = calcPeriod(employees, start, end);
    setResults(res);
    setPeriodLabel(`Last ${n} day${n !== 1 ? "s" : ""} (${start} to ${end})`);
    setStartDate(start);
    setEndDate(end);
    setView("results");
  }

  const totalPayout = results.reduce((s, r) => s + r.total, 0);

  if (view === "picker") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <p className="text-xs font-semibold text-gray-700">Select a period</p>

        {/* Today button */}
        <button
          onClick={handleToday}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-orange-400 to-amber-500 text-white text-sm font-semibold shadow-md shadow-orange-200 hover:from-orange-500 hover:to-amber-600 transition-all"
        >
          Today
        </button>

        {/* Last N days */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-shrink-0">Last</span>
          <input
            type="number"
            min={1}
            max={30}
            value={lastNDays}
            onChange={(e) => setLastNDays(parseInt(e.target.value, 10) || 1)}
            className="w-16 px-2 py-1.5 text-xs border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 text-center"
          />
          <span className="text-xs text-gray-500 flex-shrink-0">days</span>
          <button
            onClick={handleLastN}
            className="flex-1 py-1.5 px-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-semibold hover:bg-sky-100 transition-colors"
          >
            Show
          </button>
        </div>
      </div>
    );
  }

  // Results view
  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setView("picker")}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </button>
        <span className="text-[11px] text-gray-500 font-medium truncate">{periodLabel}</span>
      </div>

      {results.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">
          No check-ins recorded for this period.
        </p>
      ) : (
        <>
          {/* Results table */}
          <div className="overflow-x-auto rounded-xl border border-amber-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-amber-50 text-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-right font-semibold">Days</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.employee.id} className="border-t border-amber-50 hover:bg-amber-50/40">
                    <td className="px-3 py-2 font-medium text-gray-800">{r.employee.name}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.days}</td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.employee.salaryType === "hourly" ? `${r.totalHours}h` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.employee.salaryType === "hourly"
                        ? `₹${r.employee.salary.toFixed(2)}/hr`
                        : `₹${r.dailyRate.toFixed(2)}/day`}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                      ₹{r.total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-amber-200 bg-amber-50">
                  <td colSpan={3} className="px-3 py-2 text-xs font-bold text-gray-700">
                    Total payout
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-bold text-orange-600">
                    ₹{totalPayout.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Export buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => shareWhatsApp(results, startDate, endDate)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-semibold hover:bg-green-100 transition-colors"
            >
              <Share2 className="w-3 h-3" />
              WhatsApp
            </button>
            <button
              onClick={() => exportCsv(results, startDate, endDate)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-semibold hover:bg-sky-100 transition-colors"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
