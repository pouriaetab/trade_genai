// Thin fetch wrapper. Backend returns the standard envelope:
//   { success, data, message, timestamp }
export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  try {
    return await res.json();
  } catch {
    return { success: false, data: null, message: `HTTP ${res.status}` };
  }
}

export function post(path, body) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

export function put(path, body) {
  return api(path, { method: "PUT", body: JSON.stringify(body) });
}
