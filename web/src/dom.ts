export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Fehlendes UI-Element: ${id}`);
  }
  return element as T;
}

export function setRegionBusy(element: HTMLElement, busy: boolean): void {
  element.setAttribute("aria-busy", String(busy));
  element.classList.toggle("is-loading", busy);
}

export function replaceSelectOptions(
  select: HTMLSelectElement,
  options: ReadonlyArray<{ label: string; value: string }>,
  includeAllLabel?: string
): void {
  const selected = select.value;
  const nodes: HTMLOptionElement[] = [];
  if (includeAllLabel) {
    nodes.push(new Option(includeAllLabel, ""));
  }
  nodes.push(...options.map((option) => new Option(option.label, option.value)));
  select.replaceChildren(...nodes);
  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

export function createStatusBadge(
  state: string,
  label: string
): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset.state = state;
  const dot = document.createElement("span");
  dot.className = "status-indicator";
  dot.setAttribute("aria-hidden", "true");
  badge.append(dot, label);
  return badge;
}

export function createEmptyState(message: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}
