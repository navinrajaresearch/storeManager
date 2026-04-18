import { invoke } from "@tauri-apps/api/core";
import type { Supplier } from "../types";

export const getSuppliers = (): Promise<Supplier[]> =>
  invoke("get_suppliers");

export const addSupplier = (supplier: Omit<Supplier, "id">): Promise<Supplier> =>
  invoke("add_supplier", { supplier: { id: "", ...supplier } });

export const deleteSupplier = (id: string): Promise<void> =>
  invoke("delete_supplier", { id });
