import { invoke } from "@tauri-apps/api/core";
import type { Product, NewProduct } from "../types";

export const getProducts = (): Promise<Product[]> =>
  invoke("get_products");

export const addProduct = (product: NewProduct): Promise<Product> =>
  invoke("add_product", { product: { id: "", ...product } });

export const updateProduct = (product: Product): Promise<Product> =>
  invoke("update_product", { product });

export const deleteProduct = (id: string): Promise<void> =>
  invoke("delete_product", { id });

export const searchProducts = (query: string): Promise<Product[]> =>
  invoke("search_products", { query });
