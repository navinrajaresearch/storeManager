import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Store, BookOpen, Download, Upload } from "lucide-react";

import type { ChatMessage, Product, NewProduct, NewEmployee, Employee } from "./types";
import { processCommand } from "./lib/commands";
import { invoke } from "@tauri-apps/api/core";
import { addProduct, deleteProduct, updateProduct, getProducts } from "./lib/db";
import { addEmployee, deleteEmployee, updateEmployee, checkinEmployee } from "./lib/employeeDb";
import { nanoid } from "./utils/nanoid";
import { playClick, playPop } from "./utils/sound";

import { ChatInput } from "./components/ChatInput";
import { SuggestionChips } from "./components/SuggestionChips";
import { ProductTile } from "./components/ProductTile";
import { EmployeeTile } from "./components/EmployeeTile";
import { EmployeeForm } from "./components/EmployeeForm";
import { ImageUploader } from "./components/ImageUploader";
import { ProductConfirm } from "./components/ProductConfirm";
import { ReadmePanel } from "./components/ReadmePanel";
import { ReportWidget } from "./components/ReportWidget";
import { ReportMenuWidget } from "./components/ReportMenuWidget";
import { EmployeeReportWidget } from "./components/EmployeeReportWidget";
import { ProductChartWidget } from "./components/ProductChartWidget";
import { BrandLoader } from "./components/BrandLoader";
import { SalaryPeriodWidget } from "./components/SalaryPeriodWidget";
import { SalesTrendWidget } from "./components/SalesTrendWidget";
import "./index.css";

// ── markdown-lite renderer ────────────────────────────────────────────────────
function renderText(text: string) {
  // Bold **text** and inline code `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return parts.map((p, i) => {
    if (p === "\n") return <br key={i} />;
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="text-gray-900 font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="bg-orange-50 text-orange-600 rounded px-1 text-[11px] font-mono">{p.slice(1, -1)}</code>;
    if (p.startsWith("• "))
      return <span key={i} className="block pl-1">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}

// ── command frequency tracking ────────────────────────────────────────────────
const FREQ_KEY = "sm_cmd_freq";

function recordCommand(cmd: string) {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    const freq: Record<string, number> = raw ? JSON.parse(raw) : {};
    const key = cmd.trim().toLowerCase();
    freq[key] = (freq[key] ?? 0) + 1;
    localStorage.setItem(FREQ_KEY, JSON.stringify(freq));
  } catch {}
}

function getTopCommands(n = 3): string[] {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    if (!raw) return [];
    const freq: Record<string, number> = JSON.parse(raw);
    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([cmd]) => cmd);
  } catch {
    return [];
  }
}

// ── welcome message ───────────────────────────────────────────────────────────
function buildWelcome(): ChatMessage {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = days[new Date().getDay()];
  const isFriday = day === "Friday";
  const dayGreeting = isFriday ? `Happy ${day}! Almost the weekend!` : `Happy ${day}!`;

  const top = getTopCommands(3);
  const baseCommands = ["list products", "add product", "list employees", "reports", "help"];
  const quickCommands = [
    ...top,
    ...baseCommands.filter((c) => !top.includes(c)),
  ].slice(0, 8);

  return {
    id: "welcome",
    role: "assistant",
    text: `${dayGreeting} **Welcome to Store Manager!**`,
    quickCommands,
  };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [buildWelcome()]);
  const [busy, setBusy] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── push helpers ────────────────────────────────────────────────────────────
  function pushUser(text: string) {
    setMessages((m) => [...m, { id: nanoid(), role: "user", text }]);
  }

  function pushAssistant(partial: Partial<ChatMessage>) {
    setMessages((m) => [...m, { id: nanoid(), role: "assistant", text: "", ...partial }]);
  }

  function updateLast(patch: Partial<ChatMessage>) {
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return copy;
    });
  }

  function removeWidget(msgId: string) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, pendingProduct: undefined } : msg
    ));
  }

  // ── command handler ─────────────────────────────────────────────────────────
  async function handleCommand(input: string) {
    // "readme" opens the side panel — no chat bubble needed
    if (input.trim().toLowerCase() === "readme") {
      setShowReadme(true);
      return;
    }

    playClick();
    pushUser(input);
    setBusy(true);
    pushAssistant({ loading: true, text: "" });
    try {
      const result = await processCommand(input);
      updateLast({ loading: false, ...result });
      recordCommand(input);
    } catch (e) {
      updateLast({ loading: false, text: `Error: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  // Called from ReadmePanel when user clicks a command row
  function handleReadmeRun(cmd: string) {
    handleCommand(cmd);
  }

  // ── add-product flow callbacks ──────────────────────────────────────────────

  // Called immediately when images are dropped — show form right away
  function onImagesReady(msgId: string, images: string[], imageNames: string[]) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId
        ? {
            ...msg,
            widget: undefined,
            text: "Fill in the details — reading the packaging in the background…",
            ocrLoading: true,
            pendingProduct: {
              brand: "", name: "", sourceLanguage: "", manufactureDate: "N/A",
              expiryDate: "N/A", images, imageLocation: imageNames,
              buyPrice: 0, sellPrice: 0, quantity: 0, soldQuantity: 0,
            },
          }
        : msg
    ));
  }

  // Called when OCR finishes — update the fields
  function onOcrDone(
    msgId: string,
    product: Omit<NewProduct, "images" | "imageLocation">,
    rawText: string,
  ) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId
        ? {
            ...msg,
            ocrLoading: false,
            text: "Review and adjust if needed:",
            pendingProduct: msg.pendingProduct
              ? { ...msg.pendingProduct, ...product, rawText }
              : msg.pendingProduct,
          }
        : msg
    ));
  }

  async function onConfirm(msgId: string, product: NewProduct) {
    // Check for a product with the same name before saving
    const existing = await getProducts();
    const duplicate = existing.find(
      (p) => p.name.trim().toLowerCase() === product.name.trim().toLowerCase()
    );

    if (duplicate) {
      // Keep the form open so the user can rename if it's a different product
      setMessages((m) => m.map((msg) =>
        msg.id === msgId
          ? {
              ...msg,
              text: `**"${product.name}"** already exists in your inventory. If this is a different product, change the name and save again.`,
            }
          : msg
      ));
      return;
    }

    removeWidget(msgId);
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, pendingProduct: undefined, text: "Saving…" } : msg
    ));
    try {
      const saved = await addProduct(product);
      playPop();
      setMessages((m) => m.map((msg) =>
        msg.id === msgId
          ? { ...msg, text: `**${saved.name}** saved!`, products: [saved] }
          : msg
      ));
    } catch (e) {
      setMessages((m) => m.map((msg) =>
        msg.id === msgId ? { ...msg, text: `Failed to save: ${String(e)}` } : msg
      ));
    }
  }

  function onCancelConfirm(msgId: string) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, pendingProduct: undefined, text: "Cancelled." } : msg
    ));
  }

  function onManual(msgId: string) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId
        ? {
            ...msg,
            widget: undefined,
            text: "Fill in the details:",
            pendingProduct: {
              brand: "", sourceLanguage: "", name: "",
              manufactureDate: "N/A", expiryDate: "N/A",
              imageLocation: [], buyPrice: 0, sellPrice: 0,
              quantity: 0, soldQuantity: 0, images: [],
            },
          }
        : msg
    ));
  }

  async function handleDeleteTile(productId: string) {
    await deleteProduct(productId);
    setMessages((m) => m.map((msg) =>
      msg.products
        ? { ...msg, products: msg.products.filter((p) => p.id !== productId) }
        : msg
    ));
  }

  // ── employee flow ───────────────────────────────────────────────────────────
  async function onSaveEmployee(msgId: string, employee: NewEmployee) {
    // Initialize salary history and check-in history for new employees
    const initialSalaryHistory = employee.salary > 0
      ? JSON.stringify([{ date: employee.joiningDate, salary: employee.salary, salaryType: employee.salaryType }])
      : "[]";
    const employeeWithHistory: NewEmployee = {
      ...employee,
      checkInHistory: "",
      salaryHistory: initialSalaryHistory,
    };
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, text: "Saving…" } : msg
    ));
    try {
      const saved = await addEmployee(employeeWithHistory);
      playPop();
      setMessages((m) => m.map((msg) =>
        msg.id === msgId
          ? { ...msg, text: `**${saved.name}** added to the team!`, employees: [saved] }
          : msg
      ));
    } catch (e) {
      setMessages((m) => m.map((msg) =>
        msg.id === msgId ? { ...msg, text: `Failed to save: ${String(e)}` } : msg
      ));
    }
  }

  function onEditProduct(product: Product) {
    const id = nanoid();
    setMessages((m) => [...m, {
      id,
      role: "assistant" as const,
      text: `Editing **${product.name}** — update the fields below:`,
      widget: "product_edit" as const,
      editingProduct: product,
    }]);
  }

  async function onUpdateProduct(msgId: string, original: Product, edits: NewProduct) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, editingProduct: undefined, text: "Saving…" } : msg
    ));
    try {
      const saved = await updateProduct({ ...original, ...edits, id: original.id });
      playPop();
      setMessages((m) => m.map((msg) =>
        msg.id === msgId
          ? { ...msg, text: `**${saved.name}** updated.`, products: [saved] }
          : msg
      ));
    } catch (e) {
      setMessages((m) => m.map((msg) =>
        msg.id === msgId ? { ...msg, text: `Failed to save: ${e}` } : msg
      ));
    }
  }

  function onEditEmployee(employee: Employee) {
    const id = nanoid();
    setMessages((m) => [...m, {
      id,
      role: "assistant",
      text: `Editing **${employee.name}** — make your changes below:`,
      widget: "employee_edit",
      editingEmployee: employee,
    }]);
  }

  function onCancelProductEdit(msgId: string) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, editingProduct: undefined, text: "Cancelled." } : msg
    ));
  }

  function onCancelEmployee(msgId: string) {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, editingEmployee: undefined, text: "Cancelled." } : msg
    ));
  }

  async function onUpdateEmployee(msgId: string, original: Employee, edits: NewEmployee) {
    // Track salary history if salary or salaryType changed
    let updatedSalaryHistory = original.salaryHistory;
    if (edits.salary !== original.salary || edits.salaryType !== original.salaryType) {
      const today = new Date().toISOString().slice(0, 10);
      const existingHist: { date: string; salary: number; salaryType: string }[] =
        original.salaryHistory ? JSON.parse(original.salaryHistory) : [];
      // If history is empty, seed it with the original salary at joining date
      if (existingHist.length === 0) {
        existingHist.push({
          date: original.joiningDate,
          salary: original.salary,
          salaryType: original.salaryType,
        });
      }
      existingHist.push({ date: today, salary: edits.salary, salaryType: edits.salaryType });
      updatedSalaryHistory = JSON.stringify(existingHist);
    }
    const employeeToSave: Employee = {
      ...original,
      ...edits,
      id: original.id,
      salaryHistory: updatedSalaryHistory,
    };
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, widget: undefined, editingEmployee: undefined, text: "Saving…" } : msg
    ));
    try {
      const saved = await updateEmployee(employeeToSave);
      playPop();
      setMessages((m) => m.map((msg) =>
        msg.id === msgId
          ? { ...msg, text: `**${saved.name}** updated.`, employees: [saved] }
          : msg
      ));
      // Refresh any other messages that show this employee
      setMessages((m) => m.map((msg) =>
        msg.employees
          ? { ...msg, employees: msg.employees.map((e) => (e.id === saved.id ? saved : e)) }
          : msg
      ));
    } catch (e) {
      setMessages((m) => m.map((msg) =>
        msg.id === msgId ? { ...msg, text: `Failed to save: ${String(e)}` } : msg
      ));
    }
  }

  async function handleCheckInEmployee(employeeId: string, hours?: number) {
    const updated = await checkinEmployee(employeeId, hours);
    // If hourly and hours provided, update the salary calculation note — for now just refresh tiles
    setMessages((m) => m.map((msg) =>
      msg.employees
        ? { ...msg, employees: msg.employees.map((e) => e.id === employeeId ? updated : e) }
        : msg
    ));
    const emp = updated;
    const note = hours != null ? ` (${hours} hr${hours !== 1 ? "s" : ""} logged)` : "";
    const id = nanoid();
    setMessages((m) => [...m, { id, role: "assistant" as const, text: `**${emp.name}** checked in today${note}. Total: **${emp.checkInDays}** day${emp.checkInDays !== 1 ? "s" : ""}.`, employees: [emp] }]);
  }

  async function handleExport() {
    try {
      const json = await invoke<string>("export_data");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `store_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessages((m) => [...m, { id: nanoid(), role: "assistant" as const, text: `Export failed: ${e}` }]);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      // Quick sanity check before sending to Rust
      const parsed = JSON.parse(text);
      if (!parsed.products || !parsed.employees) throw new Error("Invalid backup file.");
      await invoke("import_data", { json: text });
      setMessages([
        buildWelcome(),
        {
          id: nanoid(),
          role: "assistant" as const,
          text: `Import complete — **${parsed.products.length}** product${parsed.products.length !== 1 ? "s" : ""} and **${parsed.employees.length}** employee${parsed.employees.length !== 1 ? "s" : ""} loaded.`,
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { id: nanoid(), role: "assistant" as const, text: `Import failed: ${e}` }]);
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteEmployee(employeeId: string) {
    await deleteEmployee(employeeId);
    setMessages((m) => m.map((msg) =>
      msg.employees
        ? { ...msg, employees: msg.employees.filter((e) => e.id !== employeeId) }
        : msg
    ));
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-gradient-to-br from-amber-50 via-orange-50/40 to-sky-50 flex flex-col overflow-hidden">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-white/80 backdrop-blur-sm shadow-sm flex-shrink-0"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-400/30">
            <Store className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800">Store Manager</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            title="Export all data to a backup file"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            title="Import data from a backup file"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-sky-200 text-sky-600 hover:text-sky-700 hover:border-sky-300 hover:bg-sky-50 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3 h-3" />
            {importing ? "Importing…" : "Import"}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => setShowReadme((s) => !s)}
            title="Command reference"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            Readme
          </button>
        </div>
      </motion.header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative">
        {/* Ambient rotating light — pure CSS, GPU composited */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="ambient-light" />
        </div>
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <Message
              key={msg.id}
              msg={msg}
              onImagesReady={(imgs, names) => onImagesReady(msg.id, imgs, names)}
              onOcrDone={(p, rawText) => onOcrDone(msg.id, p, rawText)}
              onConfirm={(p) => onConfirm(msg.id, p)}
              onCancelConfirm={() => onCancelConfirm(msg.id)}
              onManual={() => onManual(msg.id)}
              onDeleteTile={handleDeleteTile}
              onSaveEmployee={(e) => onSaveEmployee(msg.id, e)}
              onCancelEmployee={() => onCancelEmployee(msg.id)}
              onUpdateEmployee={(orig, edits) => onUpdateEmployee(msg.id, orig, edits)}
              onDeleteEmployee={handleDeleteEmployee}
              onCheckInEmployee={handleCheckInEmployee}
              onEditEmployee={onEditEmployee}
              onEditProduct={onEditProduct}
              onUpdateProduct={(orig, edits) => onUpdateProduct(msg.id, orig, edits)}
              onCancelProductEdit={() => onCancelProductEdit(msg.id)}
              onRunCommand={handleCommand}
            />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-amber-100 bg-white/90 backdrop-blur-sm px-4 py-3 flex flex-col gap-2.5">
        <SuggestionChips onSelect={handleCommand} disabled={busy} />
        <ChatInput onSubmit={handleCommand} disabled={busy} />
      </div>

      {/* Readme / command reference panel */}
      <ReadmePanel
        open={showReadme}
        onClose={() => setShowReadme(false)}
        onRun={handleReadmeRun}
      />
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
interface MessageProps {
  msg: ChatMessage;
  onImagesReady: (images: string[], imageNames: string[]) => void;
  onOcrDone: (product: Omit<NewProduct, "images" | "imageLocation">, rawText: string) => void;
  onConfirm: (p: NewProduct) => void;
  onCancelConfirm: () => void;
  onManual: () => void;
  onDeleteTile: (id: string) => void;
  onSaveEmployee: (e: NewEmployee) => void;
  onCancelEmployee: () => void;
  onUpdateEmployee: (original: Employee, edits: NewEmployee) => void;
  onDeleteEmployee: (id: string) => void;
  onCheckInEmployee: (id: string, hours?: number) => void;
  onEditEmployee: (employee: Employee) => void;
  onEditProduct: (product: Product) => void;
  onUpdateProduct: (original: Product, edits: NewProduct) => void;
  onCancelProductEdit: () => void;
  onRunCommand: (cmd: string) => void;
}

function Message({
  msg,
  onImagesReady,
  onOcrDone,
  onConfirm,
  onCancelConfirm,
  onManual,
  onDeleteTile,
  onSaveEmployee,
  onCancelEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  onCheckInEmployee,
  onEditEmployee,
  onEditProduct,
  onUpdateProduct,
  onCancelProductEdit,
  onRunCommand,
}: MessageProps) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] flex flex-col gap-3 ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        {(msg.text || msg.loading) && (
          <div
            className={`px-4 py-3 rounded-2xl text-sm leading-relaxed selectable ${
              isUser
                ? "bg-gradient-to-br from-orange-400 to-amber-500 text-white rounded-br-sm shadow-md shadow-orange-200"
                : "bg-white border border-amber-100 shadow-sm text-gray-700 rounded-bl-sm"
            }`}
          >
            {msg.loading ? (
              <BrandLoader />
            ) : (
              renderText(msg.text)
            )}
          </div>
        )}

        {/* Quick command chips */}
        {msg.quickCommands && msg.quickCommands.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.quickCommands.map((cmd, i) => (
              <button
                key={cmd}
                onClick={() => onRunCommand(cmd)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                  i < 3 && getTopCommands(3).includes(cmd)
                    ? "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                    : "bg-white border-amber-100 text-gray-600 hover:bg-amber-50 hover:border-amber-200"
                }`}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}

        {/* Image upload widget */}
        {msg.widget === "image_upload" && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ImageUploader
              onImagesReady={onImagesReady}
              onOcrDone={onOcrDone}
              onManual={onManual}
            />
          </div>
        )}

        {/* Search disambiguation widget */}
        {msg.widget === "search_disambig" && msg.searchQuery && (
          <div className="flex gap-2">
            <button
              onClick={() => onRunCommand(`search products ${msg.searchQuery}`)}
              className="flex-1 py-2 px-3 text-xs font-semibold bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-xl border border-orange-200 transition-colors"
            >
              Products
            </button>
            <button
              onClick={() => onRunCommand(`search employees ${msg.searchQuery}`)}
              className="flex-1 py-2 px-3 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl border border-indigo-200 transition-colors"
            >
              Employees
            </button>
          </div>
        )}

        {/* Report menu widget */}
        {msg.widget === "report_menu" && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ReportMenuWidget onRun={onRunCommand} />
          </div>
        )}

        {/* Product confirm / edit widget */}
        {msg.pendingProduct && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ProductConfirm
              product={msg.pendingProduct}
              images={msg.pendingProduct.images ?? []}
              imageNames={msg.pendingProduct.imageLocation ?? []}
              scanning={msg.ocrLoading}
              onConfirm={onConfirm}
              onCancel={onCancelConfirm}
            />
          </div>
        )}

        {/* Report widget — inventory */}
        {msg.widget === "report" && msg.products && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ReportWidget products={msg.products} />
          </div>
        )}

        {/* Product chart widget */}
        {msg.widget === "product_chart" && msg.products && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ProductChartWidget products={msg.products} chartPeriod={msg.chartPeriod} />
          </div>
        )}

        {/* Employee report widget */}
        {msg.widget === "employee_report" && msg.employees && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <EmployeeReportWidget employees={msg.employees} reportSubtype={msg.reportSubtype} />
          </div>
        )}

        {/* Salary report widget */}
        {msg.widget === "salary_report" && msg.employees && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <EmployeeReportWidget employees={msg.employees} reportSubtype={msg.reportSubtype} />
          </div>
        )}

        {/* Salary period picker widget */}
        {msg.widget === "salary_picker" && msg.employees && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <SalaryPeriodWidget employees={msg.employees} />
          </div>
        )}

        {/* Sales trend widget — trending / worrying products */}
        {msg.widget === "product_trend" && msg.products && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <SalesTrendWidget products={msg.products} />
          </div>
        )}

        {/* Product tiles — hidden when a chart/report/trend widget is showing them */}
        {msg.widget !== "report" && msg.widget !== "product_chart" && msg.widget !== "product_trend" && msg.products && msg.products.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence>
              {msg.products.map((p) => (
                <ProductTile key={p.id} product={p} onDelete={onDeleteTile} onEdit={onEditProduct} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Employee form widget — add new */}
        {msg.widget === "employee_form" && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <EmployeeForm
              onSave={onSaveEmployee}
              onCancel={onCancelEmployee}
            />
          </div>
        )}

        {/* Product edit widget */}
        {msg.widget === "product_edit" && msg.editingProduct && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <ProductConfirm
              product={msg.editingProduct}
              images={msg.editingProduct.images}
              imageNames={msg.editingProduct.imageLocation}
              scanning={false}
              onConfirm={(edits) => onUpdateProduct(msg.editingProduct!, edits)}
              onCancel={onCancelProductEdit}
            />
          </div>
        )}

        {/* Employee edit widget — edit existing */}
        {msg.widget === "employee_edit" && msg.editingEmployee && (
          <div className="bg-white border border-amber-100 rounded-2xl rounded-bl-sm p-4 shadow-sm">
            <EmployeeForm
              initial={msg.editingEmployee}
              onSave={(edits) => onUpdateEmployee(msg.editingEmployee!, edits)}
              onCancel={onCancelEmployee}
            />
          </div>
        )}

        {/* Employee tiles — hidden when a report widget is showing them */}
        {msg.widget !== "employee_report" && msg.widget !== "salary_report" && msg.widget !== "salary_picker" && msg.employees && msg.employees.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence>
              {msg.employees.map((e) => (
                <EmployeeTile key={e.id} employee={e} onDelete={onDeleteEmployee} onEdit={onEditEmployee} onCheckIn={onCheckInEmployee} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}
