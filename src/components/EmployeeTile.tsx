import { useState } from "react";
import { motion } from "framer-motion";
import { User, Calendar, BadgeDollarSign, Clock, Phone, Pencil, LogIn, RefreshCw } from "lucide-react";
import type { Employee } from "../types";
import { playTick } from "../utils/sound";

interface Props {
  employee: Employee;
  onDelete?: (id: string) => void;
  onEdit?: (employee: Employee) => void;
  onCheckIn?: (id: string, hours?: number) => void;
  onRefresh?: (id: string) => void;
}

export function EmployeeTile({ employee, onDelete, onEdit, onCheckIn, onRefresh }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [hours, setHours] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const checkedInToday = employee.lastCheckIn === today;

  // Parse today's stored hours for hourly employees (to prepopulate the input)
  const todayStoredHours = (() => {
    if (employee.salaryType !== "hourly") return 0;
    const entry = employee.checkInHistory.split(",").find((e) => e.startsWith(today + ":"));
    if (!entry) return 0;
    const h = parseFloat(entry.slice(today.length + 1));
    return isNaN(h) ? 0 : h;
  })();

  const initials = employee.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const tenureLabel = (() => {
    if (!employee.joiningDate || employee.joiningDate === "N/A") return null;
    const diff = Date.now() - new Date(employee.joiningDate).getTime();
    const yrs = diff / (365.25 * 24 * 60 * 60 * 1000);
    return yrs >= 1 ? `${yrs.toFixed(1)} yrs` : `${Math.round(yrs * 12)} mo`;
  })();

  return (
    <div
      className="w-44 h-60 cursor-pointer select-none flex-shrink-0"
      style={{ perspective: "1000px" }}
      onClick={() => { playTick(); setFlipped((f) => !f); }}
      title={flipped ? "Click to flip back" : "Click for details"}
    >
      <motion.div
        className="w-full h-full relative"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 160, damping: 22 }}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden shadow-md bg-gradient-to-b from-indigo-50 to-purple-50 flex flex-col items-center justify-center gap-3"
          style={{ backfaceVisibility: "hidden" }}
        >
          {/* Photo or initials avatar */}
          {employee.photo ? (
            <img
              src={employee.photo}
              alt={employee.name}
              className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-indigo-200 border-2 border-white shadow-md flex items-center justify-center">
              <span className="text-indigo-700 font-bold text-2xl">{initials}</span>
            </div>
          )}

          <div className="text-center px-3">
            <p className="text-sm font-semibold text-gray-800 leading-snug truncate w-36 text-center">
              {employee.name}
            </p>
            {tenureLabel && (
              <p className="text-[10px] text-gray-400 mt-0.5">Since {employee.joiningDate.slice(0, 7)}</p>
            )}
          </div>

          {/* Check-in badge */}
          {checkedInToday && (
            <span className="absolute top-2 right-2 text-[8px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-medium">
              In today
            </span>
          )}

          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-white/60 backdrop-blur-sm flex items-center justify-center">
            <span className="text-gray-400 text-[9px] font-bold">↻</span>
          </div>
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 rounded-2xl bg-white border border-gray-200 shadow-lg flex flex-col"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div className="px-3 pt-3 pb-2 border-b border-gray-100 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2">
              {employee.name}
            </p>
          </div>

          <div className="flex-1 px-3 py-2 flex flex-col gap-1.5">
            {employee.mobileNumber && (
              <Row label="Mobile" value={employee.mobileNumber} icon={<Phone className="w-2.5 h-2.5 text-indigo-400" />} />
            )}
            <Row label="DOB" value={employee.dob === "N/A" ? "—" : employee.dob} icon={<Calendar className="w-2.5 h-2.5 text-gray-400" />} />
            <Row label="Joined" value={employee.joiningDate} icon={<Calendar className="w-2.5 h-2.5 text-gray-400" />} />
            <Row
              label="Salary"
              value={employee.salaryType === "hourly"
                ? `₹${employee.salary.toFixed(2)}/hr`
                : `₹${employee.salary.toFixed(2)}/mo`}
              icon={<BadgeDollarSign className="w-2.5 h-2.5 text-emerald-500" />}
            />
            <Row
              label="Check-ins"
              value={`${employee.checkInDays} day${employee.checkInDays !== 1 ? "s" : ""}`}
              icon={<Clock className="w-2.5 h-2.5 text-indigo-400" />}
            />
            <Row
              label="Last check-in"
              value={employee.lastCheckIn === "N/A" ? "Never" : employee.lastCheckIn}
              icon={<Clock className="w-2.5 h-2.5 text-gray-400" />}
            />
          </div>

          {/* Check-in row */}
          {onCheckIn && (
            <div className="mx-3 mb-1">
              {checkingIn && employee.salaryType === "hourly" ? (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    placeholder="hrs"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="w-full bg-white border border-emerald-300 rounded-lg px-2 py-1 text-[10px] text-gray-800 outline-none focus:border-emerald-500"
                    autoFocus
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playTick();
                      const h = parseFloat(hours);
                      onCheckIn(employee.id, isNaN(h) || h <= 0 ? undefined : h);
                      setCheckingIn(false);
                      setHours("");
                    }}
                    className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] rounded-lg transition-colors flex-shrink-0"
                  >
                    ✓
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setCheckingIn(false); setHours(""); }}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-500 text-[10px] rounded-lg transition-colors flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playTick();
                    if (employee.salaryType === "hourly") {
                      // Prepopulate with today's stored hours if already checked in
                      setHours(todayStoredHours > 0 ? String(todayStoredHours) : "");
                      setCheckingIn(true);
                    } else {
                      onCheckIn(employee.id);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg py-1 transition-colors"
                >
                  <LogIn className="w-2.5 h-2.5" />
                  {checkedInToday && employee.salaryType === "hourly" && todayStoredHours > 0
                    ? `Checked in ✓ (${todayStoredHours}h)`
                    : checkedInToday ? "Checked in ✓" : "Check in"}
                </button>
              )}
            </div>
          )}

          <div className="mx-3 mb-2.5 flex gap-2">
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); playTick(); onEdit(employee); }}
                className="flex-1 flex items-center justify-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg py-1 transition-colors"
              >
                <Pencil className="w-2.5 h-2.5" /> Edit
              </button>
            )}
            {onRefresh && (
              <button
                onClick={(e) => { e.stopPropagation(); playTick(); onRefresh(employee.id); }}
                className="flex items-center justify-center gap-1 text-[10px] text-sky-400 hover:text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-lg py-1 px-2 transition-colors"
                title="Refresh employee data"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); playTick(); onDelete(employee.id); }}
                className="flex-1 text-[10px] text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 rounded-lg py-1 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
        {icon} {label}
      </span>
      <span className="text-[10px] text-gray-700 font-medium truncate max-w-[80px] text-right">{value}</span>
    </div>
  );
}
