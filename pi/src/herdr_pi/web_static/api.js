export async function api(path, body) {
  const options = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.error || data?.detail || text || response.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

export function showResult(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
  clearTimeout(element.clearTimer);
  if (!isError) element.clearTimer = setTimeout(() => (element.textContent = ""), 4000);
}
