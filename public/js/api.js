/**
 * Cliente da API do CRM
 */

let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/login") {
    onUnauthorized();
  }
  if (!response.ok) {
    throw new Error(data.error || `Erro ${response.status}`);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const patch = (path, body = {}) => api(path, { method: "PATCH", body });
export const del = (path) => api(path, { method: "DELETE" });

export const query = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined));
  const text = search.toString();
  return text ? `?${text}` : "";
};
