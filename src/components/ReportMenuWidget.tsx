import { BarChart2, FileText, Users, Calendar, TrendingUp, TrendingDown, Wallet } from "lucide-react";

interface ReportOption {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cmd: string;
  color: string;        // Tailwind bg class for icon circle
  iconColor: string;    // Tailwind text class for icon
  border: string;       // Tailwind border class for card
  hover: string;        // Tailwind hover bg class for card
}

const PRODUCT_REPORTS: ReportOption[] = [
  {
    icon: FileText,
    title: "Inventory report",
    description: "Full product list — share via WhatsApp, email, or download CSV",
    cmd: "inventory report",
    color: "bg-amber-100",
    iconColor: "text-amber-600",
    border: "border-amber-100",
    hover: "hover:bg-amber-50",
  },
  {
    icon: BarChart2,
    title: "Product sales chart",
    description: "Revenue & stock value breakdown by category — pie chart",
    cmd: "product chart",
    color: "bg-orange-100",
    iconColor: "text-orange-600",
    border: "border-orange-100",
    hover: "hover:bg-orange-50",
  },
  {
    icon: TrendingUp,
    title: "Trending products",
    description: "Best selling products in the last N days",
    cmd: "trending products",
    color: "bg-emerald-100",
    iconColor: "text-emerald-600",
    border: "border-emerald-100",
    hover: "hover:bg-emerald-50",
  },
  {
    icon: TrendingDown,
    title: "Unpopular products",
    description: "Products not moving or moving slowly",
    cmd: "unpopular products",
    color: "bg-red-100",
    iconColor: "text-red-500",
    border: "border-red-100",
    hover: "hover:bg-red-50",
  },
];

const EMPLOYEE_REPORTS: ReportOption[] = [
  {
    icon: Users,
    title: "Employee overview",
    description: "All staff — salary, tenure, attendance, export as CSV",
    cmd: "employee report",
    color: "bg-violet-100",
    iconColor: "text-violet-600",
    border: "border-violet-100",
    hover: "hover:bg-violet-50",
  },
  {
    icon: Calendar,
    title: "Salary period report",
    description: "Pick a date range and see payout per employee based on check-in history",
    cmd: "salary report",
    color: "bg-sky-100",
    iconColor: "text-sky-600",
    border: "border-sky-100",
    hover: "hover:bg-sky-50",
  },
  {
    icon: TrendingUp,
    title: "Monthly payroll",
    description: "Month-to-date spend — how much has been paid out this month",
    cmd: "monthly salary",
    color: "bg-emerald-100",
    iconColor: "text-emerald-600",
    border: "border-emerald-100",
    hover: "hover:bg-emerald-50",
  },
  {
    icon: Wallet,
    title: "Company employee spend",
    description: "Total monthly & annual payroll with per-person cost breakdown",
    cmd: "company spend",
    color: "bg-indigo-100",
    iconColor: "text-indigo-600",
    border: "border-indigo-100",
    hover: "hover:bg-indigo-50",
  },
];

interface Props {
  onRun: (cmd: string) => void;
}

function OptionCard({ option, onRun }: { option: ReportOption; onRun: (cmd: string) => void }) {
  const Icon = option.icon;
  return (
    <button
      onClick={() => onRun(option.cmd)}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border ${option.border} bg-white ${option.hover} transition-colors text-left group`}
    >
      <div className={`w-7 h-7 rounded-lg ${option.color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon className={`w-3.5 h-3.5 ${option.iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-800 leading-snug group-hover:text-gray-900">
          {option.title}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{option.description}</p>
      </div>
    </button>
  );
}

export function ReportMenuWidget({ onRun }: Props) {
  return (
    <div className="flex flex-col gap-3 w-full max-w-xs">
      <div>
        <p className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold mb-1.5 px-0.5">
          Product reports
        </p>
        <div className="flex flex-col gap-1.5">
          {PRODUCT_REPORTS.map((opt) => (
            <OptionCard key={opt.cmd} option={opt} onRun={onRun} />
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] text-sky-500 uppercase tracking-wider font-semibold mb-1.5 px-0.5">
          Employee reports
        </p>
        <div className="flex flex-col gap-1.5">
          {EMPLOYEE_REPORTS.map((opt) => (
            <OptionCard key={opt.cmd} option={opt} onRun={onRun} />
          ))}
        </div>
      </div>
    </div>
  );
}
