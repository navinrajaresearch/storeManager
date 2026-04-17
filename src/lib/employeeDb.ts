import { invoke } from "@tauri-apps/api/core";
import type { Employee, NewEmployee } from "../types";

export const getEmployees = (): Promise<Employee[]> =>
  invoke("get_employees");

export const addEmployee = (employee: NewEmployee): Promise<Employee> =>
  invoke("add_employee", { employee: { id: "", ...employee } });

export const updateEmployee = (employee: Employee): Promise<Employee> =>
  invoke("update_employee", { employee });

export const deleteEmployee = (id: string): Promise<void> =>
  invoke("delete_employee", { id });

/** Record a check-in for today. Idempotent — won't double-count.
 *  For hourly employees, pass `hours` worked today so the salary report uses the real value. */
export const checkinEmployee = (id: string, hours?: number): Promise<Employee> =>
  invoke("checkin_employee", {
    id,
    date: new Date().toISOString().slice(0, 10),
    hours: hours ?? null,
  });
