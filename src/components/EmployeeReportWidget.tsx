import { useState } from "react";
import { Download, Copy, Check, MessageCircle, Mail, Users, Calendar, Clock, TrendingUp } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Employee } from "../types";
import { monthlyEquivalent } from "../types";

interface Props {
  employees: Employee[];
  reportSubtype?: string; // "all" | "salary_today" | "salary_month" | "company_spend"
}

function tenureLabel(joiningDate: string): string {
  if (!joiningDate || joiningDate === "N/A") return "—";
  const diff = Date.now() - new Date(joiningDate).getTime();
  const yrs = diff / (365.25 * 24 * 60 * 60 * 1000);
  return yrs >= 1 ? `${yrs.toFixed(1)}y` : `${Math.round(yrs * 12)}mo`;
}

export function EmployeeReportWidget({ employees, reportSubtype = "all" }: Props) {
  const [copied, setCopied] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dayOfMonth = new Date().getDate();

  const totalMonthly = employees.reduce((s, e) => s + monthlyEquivalent(e), 0);
  const totalAnnual = totalMonthly * 12;
  const totalDaily = employees.reduce((s, e) => s + monthlyEquivalent(e) / 30, 0);
  const totalMonthToDate = employees.reduce((s, e) => s + (monthlyEquivalent(e) / daysInMonth) * dayOfMonth, 0);
  const checkedInToday = employees.filter((e) => e.lastCheckIn === today).length;

  const sorted = [...employees].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));

  function toCsv(): string {
    const header = "Name,Rate,Rate type,Monthly equivalent,Annual equivalent,Daily rate,Tenure,Check-in days,Last check-in,Mobile";
    const rows = sorted.map((e) => {
      const mo = monthlyEquivalent(e);
      return [
        `"${e.name.replace(/"/g, '""')}"`,
        e.salary.toFixed(2),
        e.salaryType ?? "monthly",
        mo.toFixed(2),
        (mo * 12).toFixed(2),
        (mo / 30).toFixed(2),
        tenureLabel(e.joiningDate),
        e.checkInDays,
        e.lastCheckIn,
        e.mobileNumber,
      ].join(",");
    });
    return [header, ...rows].join("\n");
  }

  function toWhatsApp(): string {
    const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const lines: string[] = [
      `👥 *Employee Report*`,
      `_${date} · ${employees.length} staff member${employees.length !== 1 ? "s" : ""}_`,
      ``,
      `💰 Monthly payroll: ₹${totalMonthly.toFixed(2)}`,
      `📅 Annual payroll: ₹${totalAnnual.toFixed(2)}`,
    ];
    if (reportSubtype === "salary_today")
      lines.push(`📆 Today's daily payout: ₹${totalDaily.toFixed(2)}`);
    if (reportSubtype === "salary_month")
      lines.push(`📊 Month-to-date (${dayOfMonth}/${daysInMonth} days): ₹${totalMonthToDate.toFixed(2)}`);
    lines.push(``, `*Staff:*`);
    sorted.forEach((e, i) => {
      const rateLabel = e.salaryType === "hourly"
        ? `₹${e.salary.toFixed(2)}/hr (≈₹${monthlyEquivalent(e).toFixed(0)}/mo)`
        : `₹${e.salary.toFixed(2)}/mo`;
      lines.push(
        `${i + 1}. *${e.name}*`,
        `   ${rateLabel} · ${tenureLabel(e.joiningDate)} tenure · ${e.checkInDays} days present`,
        ``,
      );
    });
    return lines.join("\n").trimEnd();
  }

  function toPlainText(): string {
    const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
    const header = `EMPLOYEE REPORT — ${new Date().toLocaleDateString("en-GB")}\n${"─".repeat(72)}\n`;
    const col = `${pad("Name", 20)} ${pad("Salary/mo", 12)} ${pad("Annual", 12)} Tenure  Days\n${"─".repeat(72)}\n`;
    const rows = sorted
      .map(
        (e) =>
          `${pad(e.name, 20)} ₹${pad(e.salary.toFixed(2), 11)} ₹${pad((e.salary * 12).toFixed(2), 11)} ${pad(tenureLabel(e.joiningDate), 7)} ${e.checkInDays}`
      )
      .join("\n");
    const footer = `\n${"─".repeat(72)}\nTotal monthly: ₹${totalMonthly.toFixed(2)} · Annual: ₹${totalAnnual.toFixed(2)}\n`;
    return header + col + rows + footer;
  }

  async function copyText() {
    await navigator.clipboard.writeText(toWhatsApp());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCsv() {
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function shareWhatsApp() {
    openUrl(`whatsapp://send?text=${encodeURIComponent(toWhatsApp())}`);
  }

  function shareEmail() {
    const date = new Date().toLocaleDateString("en-GB");
    openUrl(
      `mailto:?subject=${encodeURIComponent(`Employee Report — ${date}`)}&body=${encodeURIComponent(toPlainText())}`
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-amber-500 uppercase tracking-wide">Monthly payroll</p>
          <p className="text-sm font-bold text-amber-700">₹{totalMonthly.toFixed(2)}</p>
        </div>
        <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
          <p className="text-[10px] text-sky-500 uppercase tracking-wide">Annual spend</p>
          <p className="text-sm font-bold text-sky-700">₹{totalAnnual.toFixed(2)}</p>
        </div>

        {reportSubtype === "salary_today" && (
          <div className="col-span-2 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-orange-400 uppercase tracking-wide">Today's daily payout</p>
              <p className="text-sm font-bold text-orange-600">₹{totalDaily.toFixed(2)}</p>
            </div>
            <Calendar className="w-5 h-5 text-orange-300" />
          </div>
        )}

        {reportSubtype === "salary_month" && (
          <div className="col-span-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-emerald-500 uppercase tracking-wide">
                Month-to-date ({dayOfMonth}/{daysInMonth} days)
              </p>
              <p className="text-sm font-bold text-emerald-700">₹{totalMonthToDate.toFixed(2)}</p>
            </div>
            <TrendingUp className="w-5 h-5 text-emerald-300" />
          </div>
        )}

        <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <div>
            <p className="text-[10px] text-violet-400 uppercase tracking-wide">Staff</p>
            <p className="text-sm font-bold text-violet-600">{employees.length}</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-[10px] text-green-500 uppercase tracking-wide">In today</p>
            <p className="text-sm font-bold text-green-700">
              {checkedInToday} / {employees.length}
            </p>
          </div>
        </div>
      </div>

      {/* Employee table */}
      <div className="border border-amber-100 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
        {sorted.map((e, i) => {
          const isIn = e.lastCheckIn === today;
          return (
            <div key={e.id} className={`px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-amber-50/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {e.photo ? (
                    <img src={e.photo} alt={e.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-300 to-amber-400 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[9px] font-bold">{e.name[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{e.name}</p>
                    <p className="text-[9px] text-gray-400">
                      {tenureLabel(e.joiningDate)} · {e.checkInDays} days
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {e.salaryType === "hourly" ? (
                    <p className="text-xs font-semibold text-gray-700">
                      ₹{e.salary.toFixed(2)}
                      <span className="text-[9px] text-gray-400">/hr</span>
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-gray-700">
                      ₹{e.salary.toFixed(0)}
                      <span className="text-[9px] text-gray-400">/mo</span>
                    </p>
                  )}
                  {reportSubtype === "salary_today" && (
                    <p className="text-[9px] text-orange-500">₹{(monthlyEquivalent(e) / 30).toFixed(2)}/day</p>
                  )}
                  {reportSubtype === "salary_month" && (
                    <p className="text-[9px] text-emerald-600">₹{((monthlyEquivalent(e) / daysInMonth) * dayOfMonth).toFixed(2)} mtd</p>
                  )}
                  {reportSubtype === "company_spend" && (
                    <p className="text-[9px] text-sky-500">
                      {((monthlyEquivalent(e) / (totalMonthly || 1)) * 100).toFixed(1)}%
                    </p>
                  )}
                  <p className={`text-[8px] mt-0.5 font-medium ${isIn ? "text-green-500" : "text-gray-300"}`}>
                    {isIn ? "● in today" : "○ absent"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Company spend bar chart */}
      {reportSubtype === "company_spend" && sorted.length > 0 && (
        <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-100 rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-sky-500 uppercase tracking-wide mb-2">Annual cost breakdown</p>
          {sorted.slice(0, 5).map((e) => (
            <div key={e.id} className="flex items-center gap-2 mb-1.5">
              <div className="flex-1 text-[10px] text-gray-600 truncate">{e.name}</div>
              <div className="text-[10px] text-gray-500 w-16 text-right">₹{(monthlyEquivalent(e) * 12).toFixed(0)}</div>
              <div className="w-14 h-1.5 bg-sky-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 to-indigo-400 rounded-full"
                  style={{ width: `${(monthlyEquivalent(e) / (monthlyEquivalent(sorted[0]) || 1)) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {sorted.length > 5 && (
            <p className="text-[9px] text-gray-400 mt-0.5">+{sorted.length - 5} more</p>
          )}
        </div>
      )}

      {/* Share buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <button
            onClick={shareWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp
          </button>
          <button
            onClick={shareEmail}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copyText}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-medium transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied!" : "Copy text"}
          </button>
          <button
            onClick={downloadCsv}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-medium transition-colors"
          >
            <Download className="w-3 h-3" />
            Download CSV
          </button>
        </div>
      </div>
    </div>
  );
}
