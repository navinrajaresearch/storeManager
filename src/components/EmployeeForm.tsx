import { useRef, useState } from "react";
import { Check, X, Camera } from "lucide-react";
import type { Employee, NewEmployee } from "../types";
import { playPop, playTick } from "../utils/sound";

interface Props {
  initial?: Employee;   // present when editing an existing employee
  onSave: (employee: NewEmployee) => void;
  onCancel: () => void;
}

const today = new Date().toISOString().slice(0, 10);

export function EmployeeForm({ initial, onSave, onCancel }: Props) {
  const [form, setForm] = useState<NewEmployee>(
    initial
      ? {
          name:             initial.name,
          photo:            initial.photo,
          salary:           initial.salary,
          salaryType:       initial.salaryType ?? "monthly",
          dob:              initial.dob,
          joiningDate:      initial.joiningDate,
          mobileNumber:     initial.mobileNumber,
          checkInDays:      initial.checkInDays,
          lastCheckIn:      initial.lastCheckIn,
          checkInHistory:   initial.checkInHistory ?? "",
          salaryHistory:    initial.salaryHistory ?? "",
        }
      : {
          name:             "",
          photo:            "",
          salary:           0,
          salaryType:       "monthly",
          dob:              "",
          joiningDate:      today,
          mobileNumber:     "",
          checkInDays:      0,
          lastCheckIn:      "N/A",
          checkInHistory:   "",
          salaryHistory:    "",
        }
  );

  const fileRef = useRef<HTMLInputElement>(null);

  function handlePhoto(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setForm((f) => ({ ...f, photo: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit() {
    if (!form.name.trim()) return;
    playPop();
    onSave({ ...form, name: form.name.trim() });
  }

  const inp =
    "w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-indigo-400 transition-colors selectable";

  function field(label: string, node: React.ReactNode) {
    return (
      <div>
        <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-0.5">
          {label}
        </label>
        {node}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      {/* Photo upload */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { playTick(); fileRef.current?.click(); }}
          className="w-16 h-16 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 hover:border-indigo-400 flex items-center justify-center overflow-hidden transition-colors flex-shrink-0"
          title="Upload photo"
        >
          {form.photo ? (
            <img src={form.photo} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <Camera className="w-5 h-5 text-gray-400" />
          )}
        </button>
        <div className="flex-1">
          <p className="text-xs text-gray-500">
            {form.photo ? "Photo selected — click to change" : "Click the circle to upload a photo (optional)"}
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handlePhoto(f);
          }}
        />
      </div>

      {/* Personal info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-indigo-600 uppercase tracking-wider font-medium">Personal details</p>

        {field("Full name *",
          <input
            className={inp}
            placeholder="e.g. Alice Johnson"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        )}

        {field("Mobile number",
          <input
            type="tel"
            className={inp}
            placeholder="e.g. +1 555 000 0000"
            value={form.mobileNumber}
            onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          {field("Date of birth",
            <input
              type="date"
              className={inp}
              value={form.dob === "N/A" ? "" : form.dob}
              onChange={(e) => setForm({ ...form, dob: e.target.value || "N/A" })}
            />
          )}
          {field("Joining date",
            <input
              type="date"
              className={inp}
              value={form.joiningDate}
              onChange={(e) => setForm({ ...form, joiningDate: e.target.value || today })}
            />
          )}
        </div>
      </div>

      {/* Salary */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[10px] text-amber-600 uppercase tracking-wider font-medium">Compensation</p>

        {/* Hourly / Monthly toggle */}
        <div className="flex gap-1 bg-amber-100/60 rounded-lg p-0.5">
          {(["monthly", "hourly"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setForm((f) => ({ ...f, salaryType: type }))}
              className={`flex-1 text-[11px] py-1 rounded-md font-medium transition-all ${
                form.salaryType === type
                  ? "bg-white text-amber-700 shadow-sm"
                  : "text-amber-500 hover:text-amber-600"
              }`}
            >
              {type === "monthly" ? "Monthly" : "Hourly"}
            </button>
          ))}
        </div>

        {field(
          form.salaryType === "monthly" ? "Monthly salary (₹)" : "Hourly rate (₹)",
          <div className="relative">
            <input
              type="number"
              min={0}
              step="0.01"
              className={inp}
              value={form.salary || ""}
              placeholder="0.00"
              onChange={(e) => setForm({ ...form, salary: parseFloat(e.target.value) || 0 })}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">
              {form.salaryType === "monthly" ? "/mo" : "/hr"}
            </span>
          </div>
        )}

        {form.salaryType === "hourly" && form.salary > 0 && (
          <p className="text-[10px] text-amber-600">
            ≈ ₹{(form.salary * 176).toFixed(2)}/mo <span className="text-amber-400">(8 hrs × 22 days)</span>
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!form.name.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-2 rounded-xl transition-colors"
        >
          <Check className="w-4 h-4" /> {initial ? "Save changes" : "Save employee"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
