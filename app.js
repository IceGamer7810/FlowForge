const STORAGE_KEY = "flowforge-state-v1";
const CLOCK_SLIDER_MIN = 0.01;
const CLOCK_SLIDER_MAX = 250;
const CLOCK_STEP = 1;
const MAX_NETWORK_DEPTH = 4;
const HARD_NETWORK_DEPTH = 5;

const uid = (() => {
  let i = 1;
  return (prefix) => `${prefix}-${i++}`;
})();

function emptyBeltRow() {
  return { id: uid("belt"), value: "" };
}

function emptyItemRow() {
  return { id: uid("item"), name: "", color: "", belts: [emptyBeltRow()] };
}

function emptyIoRow(kind) {
  return { id: uid(kind), itemId: "", qty: "" };
}

function emptyRecipe() {
  return {
    id: uid("recipe"),
    name: "",
    inputs: [emptyIoRow("rin")],
    outputs: [emptyIoRow("rout")],
    outputRate: "",
    craftTime: "",
    power: "",
    syncSource: "rate"
  };
}

function emptyProcessRow() {
  return { id: uid("proc"), inputItemId: "", outputItemId: "" };
}

function createDefaultState() {
  return {
    itemRows: [emptyItemRow()],
    recipes: [emptyRecipe()],
    processRows: [emptyProcessRow()],
    settings: {
      beltSpeeds: "60, 120, 270, 480, 780",
      splitterSizes: "2, 3",
      mergerSizes: "2, 3",
      maxPower: "1000",
      clockMin: "1",
      clockMax: "250"
    }
  };
}

function sanitizeState(input) {
  const base = createDefaultState();
  const next = {
    itemRows: Array.isArray(input.itemRows) ? input.itemRows : base.itemRows,
    recipes: Array.isArray(input.recipes) ? input.recipes : base.recipes,
    processRows: Array.isArray(input.processRows) ? input.processRows : base.processRows,
    settings: { ...base.settings, ...(input.settings || {}) }
  };

  next.itemRows = next.itemRows.map((row) => ({
    id: row.id || uid("item"),
    name: String(row.name || ""),
    color: String(row.color || ""),
    belts: Array.isArray(row.belts) && row.belts.length
      ? row.belts.map((belt) => ({ id: belt.id || uid("belt"), value: String(belt.value ?? "") }))
      : [emptyBeltRow()]
  }));

  next.recipes = next.recipes.map((recipe) => ({
    id: recipe.id || uid("recipe"),
    name: String(recipe.name || ""),
    inputs: Array.isArray(recipe.inputs) && recipe.inputs.length
      ? recipe.inputs.map((row) => ({ id: row.id || uid("rin"), itemId: String(row.itemId || ""), qty: String(row.qty ?? "") }))
      : [emptyIoRow("rin")],
    outputs: Array.isArray(recipe.outputs) && recipe.outputs.length
      ? recipe.outputs.map((row) => ({ id: row.id || uid("rout"), itemId: String(row.itemId || ""), qty: String(row.qty ?? "") }))
      : [emptyIoRow("rout")],
    outputRate: String(recipe.outputRate ?? ""),
    craftTime: String(recipe.craftTime ?? ""),
    power: String(recipe.power ?? ""),
    syncSource: recipe.syncSource === "time" ? "time" : "rate"
  }));

  next.processRows = next.processRows.map((row) => ({
    id: row.id || uid("proc"),
    inputItemId: String(row.inputItemId || ""),
    outputItemId: String(row.outputItemId || "")
  }));

  ensureTrailingStructures(next);
  sanitizeReferences(next);
  return next;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : createDefaultState();
  } catch (error) {
    return createDefaultState();
  }
}

let state = loadState();
let colorPickerState = {
  open: false,
  targetItemId: "",
  targetField: "color",
  hue: 0,
  sat: 100,
  val: 100,
  draftHex: "#ff0000"
};
let colorPickerGlobalEventsBound = false;

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseNumber(value) {
  if (typeof value !== "string") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function normalizeNumericString(value, digits = 4) {
  const num = parseNumber(value);
  if (num === null) return "";
  return String(Number(num.toFixed(digits)));
}

function ceilTwoDecimals(num) {
  return Math.ceil(num * 100) / 100;
}

function fmt(num, digits = 2) {
  if (!Number.isFinite(num)) return "0";
  return Number(num.toFixed(digits)).toString();
}

function getClockSliderValue(value) {
  const parsed = parseNumber(String(value));
  if (parsed === null) return Math.round(CLOCK_SLIDER_MIN);
  return Math.max(Math.round(CLOCK_SLIDER_MIN), Math.min(Math.round(parsed), Math.round(CLOCK_SLIDER_MAX)));
}

function randomVisibleColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 65 + Math.floor(Math.random() * 20);
  const l = 48 + Math.floor(Math.random() * 12);
  return `hsl(${h} ${s}% ${l}%)`;
}

function colorContext() {
  if (!colorContext.ctx) colorContext.ctx = document.createElement("canvas").getContext("2d");
  return colorContext.ctx;
}

function parseCssColorToHex(value) {
  const ctx = colorContext();
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  const normalized = ctx.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toLowerCase();
  const match = normalized.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (!match) return "#ff0000";
  const [r, g, b] = match.slice(1).map((part) => Number(part));
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const normalized = parseCssColorToHex(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * (((bn - rn) / delta) + 2);
    else h = 60 * (((rn - gn) / delta) + 4);
  }

  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}

function setColorPickerDraftFromHex(hex) {
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  colorPickerState.hue = hsv.h;
  colorPickerState.sat = hsv.s;
  colorPickerState.val = hsv.v;
  colorPickerState.draftHex = parseCssColorToHex(hex);
}

function updateColorPickerDraft() {
  const rgb = hsvToRgb(colorPickerState.hue, colorPickerState.sat, colorPickerState.val);
  colorPickerState.draftHex = rgbToHex(rgb.r, rgb.g, rgb.b);
}

function openColorPicker(itemId, field = "color") {
  const row = state.itemRows.find((entry) => entry.id === itemId);
  const baseColor = row?.[field] && isValidColor(row[field]) ? row[field] : "#ff0000";
  colorPickerState.open = true;
  colorPickerState.targetItemId = itemId;
  colorPickerState.targetField = field;
  setColorPickerDraftFromHex(baseColor);
  renderColorPicker();
}

function closeColorPicker() {
  colorPickerState.open = false;
  colorPickerState.targetItemId = "";
  renderColorPicker();
}

function applyColorPicker() {
  const row = state.itemRows.find((entry) => entry.id === colorPickerState.targetItemId);
  if (!row) {
    closeColorPicker();
    return;
  }
  row[colorPickerState.targetField] = colorPickerState.draftHex;
  colorPickerState.open = false;
  colorPickerState.targetItemId = "";
  render();
}

function bindColorPickerGlobalEvents() {
  if (colorPickerGlobalEventsBound) return;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && colorPickerState.open) closeColorPicker();
  });
  colorPickerGlobalEventsBound = true;
}

function isValidColor(value) {
  if (!value.trim()) return false;
  const probe = new Option().style;
  probe.color = "";
  probe.color = value.trim();
  return probe.color !== "";
}

function isItemRowEmpty(row) {
  return !row.name.trim() && !row.color.trim();
}

function getItemRowStatuses(targetState = state) {
  const meaningfulRows = targetState.itemRows.filter((row) => !isItemRowEmpty(row));
  const nameCounts = new Map();
  const colorCounts = new Map();

  meaningfulRows.forEach((row) => {
    const nameKey = row.name.trim().toLowerCase();
    const colorKey = row.color.trim().toLowerCase();
    if (nameKey) nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
    if (colorKey) colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
  });

  const statuses = new Map();
  targetState.itemRows.forEach((row) => {
    const nameKey = row.name.trim().toLowerCase();
    const colorKey = row.color.trim().toLowerCase();
    const valid = Boolean(
      nameKey &&
      isValidColor(row.color) &&
      nameCounts.get(nameKey) === 1 &&
      colorKey &&
      colorCounts.get(colorKey) === 1
    );
    statuses.set(row.id, {
      empty: isItemRowEmpty(row),
      valid
    });
  });

  return statuses;
}

function isValidItemRow(row, targetState = state) {
  return getItemRowStatuses(targetState).get(row.id)?.valid || false;
}

function ensureItemRows(targetState = state) {
  const meaningfulRows = targetState.itemRows.filter((row) => !isItemRowEmpty(row));
  targetState.itemRows = meaningfulRows.length ? [...meaningfulRows] : [];

  const statuses = getItemRowStatuses(targetState);
  const trimmedRows = [];

  for (const row of targetState.itemRows) {
    trimmedRows.push(row);
    if (!statuses.get(row.id)?.valid) break;
  }

  targetState.itemRows = trimmedRows;

  const allMeaningfulValid = targetState.itemRows.length > 0 &&
    targetState.itemRows.every((row) => statuses.get(row.id)?.valid);

  if (allMeaningfulValid || targetState.itemRows.length === 0) {
    targetState.itemRows.push(emptyItemRow());
  }

  if (!targetState.itemRows.length) {
    targetState.itemRows.push(emptyItemRow());
  }
}

function isValidProcessRow(row) {
  return row.inputItemId && row.outputItemId;
}

function ensureTrailingBelts(itemRow) {
  const nonEmpty = itemRow.belts.filter((belt) => belt.value !== "");
  itemRow.belts = [...nonEmpty, emptyBeltRow()];
}

function sanitizeBeltSelections(targetState = state) {
  const validBeltValues = new Set(parseListNumbers(targetState.settings.beltSpeeds, false).map((value) => String(value)));
  targetState.itemRows.forEach((row) => {
    row.belts.forEach((belt) => {
      if (belt.value !== "" && !validBeltValues.has(String(belt.value))) {
        belt.value = "";
      }
    });
  });
}

function ensureTrailingIoRows(list, kind) {
  const nonEmpty = list.filter((row) => row.itemId || row.qty !== "");
  list.length = 0;
  nonEmpty.forEach((row) => list.push(row));
  list.push(emptyIoRow(kind));
}

function ensureTrailingStructures(targetState = state) {
  ensureItemRows(targetState);
  sanitizeBeltSelections(targetState);
  targetState.itemRows.forEach((row) => ensureTrailingBelts(row));

  if (!targetState.recipes.length) targetState.recipes.push(emptyRecipe());
  targetState.recipes.forEach((recipe) => {
    ensureTrailingIoRows(recipe.inputs, "rin");
    ensureTrailingIoRows(recipe.outputs, "rout");
  });

  if (!targetState.processRows.length) targetState.processRows.push(emptyProcessRow());
  if (isValidProcessRow(targetState.processRows[targetState.processRows.length - 1])) targetState.processRows.push(emptyProcessRow());
}

function getDefinedItems(targetState = state) {
  const itemStatuses = getItemRowStatuses(targetState);
  return targetState.itemRows
    .filter((row) => itemStatuses.get(row.id)?.valid)
    .map((row) => ({
      id: row.id,
      name: row.name.trim(),
      color: row.color.trim(),
      belts: row.belts
    }));
}

function getItemMap(targetState = state) {
  return new Map(getDefinedItems(targetState).map((item) => [item.id, item]));
}

function sanitizeReferences(targetState = state) {
  const validIds = new Set(getDefinedItems(targetState).map((item) => item.id));
  targetState.recipes.forEach((recipe) => {
    recipe.inputs.forEach((row) => { if (row.itemId && !validIds.has(row.itemId)) row.itemId = ""; });
    recipe.outputs.forEach((row) => { if (row.itemId && !validIds.has(row.itemId)) row.itemId = ""; });
  });
  targetState.processRows.forEach((row) => {
    if (row.inputItemId && !validIds.has(row.inputItemId)) row.inputItemId = "";
    if (row.outputItemId && !validIds.has(row.outputItemId)) row.outputItemId = "";
  });
}

function parseListNumbers(text, integerOnly = false) {
  return String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => integerOnly ? Math.trunc(Number(part)) : Number(part))
    .filter((num) => Number.isFinite(num) && num > 0)
    .filter((num, index, array) => array.indexOf(num) === index)
    .sort((a, b) => a - b);
}

function formatListNumbers(values) {
  return values.map((value) => String(value)).join(", ");
}

function getSettingsNumbers() {
  const beltSpeeds = parseListNumbers(state.settings.beltSpeeds, false);
  const splitterSizes = parseListNumbers(state.settings.splitterSizes, true);
  const mergerSizes = parseListNumbers(state.settings.mergerSizes, true);
  const maxPower = parseNumber(state.settings.maxPower) ?? 0;
  let minClock = parseNumber(state.settings.clockMin) ?? 1;
  let maxClock = parseNumber(state.settings.clockMax) ?? 250;
  minClock = Math.max(CLOCK_SLIDER_MIN, Math.min(minClock, CLOCK_SLIDER_MAX));
  maxClock = Math.max(minClock, Math.min(maxClock, CLOCK_SLIDER_MAX));
  return { beltSpeeds, splitterSizes, mergerSizes, maxPower, minClock, maxClock };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contrastColor(color) {
  const temp = document.createElement("canvas").getContext("2d");
  temp.fillStyle = color;
  const normalized = temp.fillStyle;
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return "#111";
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111" : "#fff";
}

function findDuplicateItemNames(items) {
  const seen = new Map();
  const duplicates = [];
  items.forEach((item) => {
    const key = item.name.trim().toLowerCase();
    if (!key) return;
    if (seen.has(key) && !duplicates.includes(item.name.trim())) duplicates.push(item.name.trim());
    seen.set(key, item.id);
  });
  return duplicates;
}

function deriveItemRoles(targetState = state) {
  const items = getDefinedItems(targetState);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const externalInputIds = new Set();
  const producedIds = new Set();
  const recipeInputReferencedIds = new Set();
  const recipeOutputReferencedIds = new Set();
  const processInputReferencedIds = new Set();
  const processOutputReferencedIds = new Set();
  const referencedIds = new Set();

  items.forEach((item) => {
    const totalBelt = item.belts
      .map((belt) => parseNumber(belt.value))
      .filter((num) => num !== null && num > 0)
      .reduce((sum, num) => sum + num, 0);
    if (totalBelt > 0) externalInputIds.add(item.id);
  });

  targetState.recipes.forEach((recipe) => {
    recipe.inputs.forEach((row) => {
      if (!row.itemId || !itemMap.has(row.itemId)) return;
      recipeInputReferencedIds.add(row.itemId);
      referencedIds.add(row.itemId);
    });
    recipe.outputs.forEach((row) => {
      if (!row.itemId || !itemMap.has(row.itemId)) return;
      recipeOutputReferencedIds.add(row.itemId);
      producedIds.add(row.itemId);
      referencedIds.add(row.itemId);
    });
  });

  targetState.processRows.forEach((row) => {
    if (row.inputItemId && itemMap.has(row.inputItemId)) {
      processInputReferencedIds.add(row.inputItemId);
      referencedIds.add(row.inputItemId);
    }
    if (row.outputItemId && itemMap.has(row.outputItemId)) {
      processOutputReferencedIds.add(row.outputItemId);
      referencedIds.add(row.outputItemId);
    }
  });

  const validSourceIds = new Set([...externalInputIds, ...producedIds]);
  const invalidIds = new Set();
  const internalOnlyIds = new Set();

  items.forEach((item) => {
    const hasExternal = externalInputIds.has(item.id);
    const hasProduction = producedIds.has(item.id);
    const isReferenced = referencedIds.has(item.id);
    if (!hasExternal) internalOnlyIds.add(item.id);
    if (!hasExternal && !hasProduction && isReferenced) invalidIds.add(item.id);
  });

  const recipeInputSelectableIds = items
    .filter((item) => validSourceIds.has(item.id))
    .map((item) => item.id);
  const processInputSelectableIds = items
    .filter((item) => validSourceIds.has(item.id))
    .map((item) => item.id);
  const processOutputSelectableIds = items
    .filter((item) => producedIds.has(item.id))
    .map((item) => item.id);

  const roles = new Map();
  items.forEach((item) => {
    const roleParts = [];
    if (externalInputIds.has(item.id)) roleParts.push("external_input");
    if (producedIds.has(item.id)) roleParts.push("producible");
    if (internalOnlyIds.has(item.id)) roleParts.push("internal_only");
    if (invalidIds.has(item.id)) roleParts.push("invalid");
    roles.set(item.id, roleParts);
  });

  return {
    items,
    itemMap,
    roles,
    externalInputIds,
    producedIds,
    recipeInputReferencedIds,
    recipeOutputReferencedIds,
    processInputReferencedIds,
    processOutputReferencedIds,
    referencedIds,
    validSourceIds,
    invalidIds,
    internalOnlyIds,
    recipeInputSelectableIds,
    processInputSelectableIds,
    processOutputSelectableIds
  };
}

function getValidRecipeEntries(recipe, itemMap) {
  const inputs = recipe.inputs
    .map((row) => ({ ...row, qtyNum: parseNumber(row.qty) }))
    .filter((row) => row.itemId && itemMap.has(row.itemId) && row.qtyNum !== null && row.qtyNum > 0);
  const outputs = recipe.outputs
    .map((row) => ({ ...row, qtyNum: parseNumber(row.qty) }))
    .filter((row) => row.itemId && itemMap.has(row.itemId) && row.qtyNum !== null && row.qtyNum > 0);
  return { inputs, outputs };
}

function syncRecipePair(recipe) {
  const itemMap = getItemMap();
  const { outputs } = getValidRecipeEntries(recipe, itemMap);
  const primary = outputs[0];
  if (!primary || !primary.qtyNum || primary.qtyNum <= 0) return;

  if (recipe.syncSource === "time") {
    const craft = parseNumber(recipe.craftTime);
    if (craft !== null && craft > 0) {
      recipe.outputRate = normalizeNumericString(String(primary.qtyNum * 60 / craft), 6);
    }
  } else {
    const rate = parseNumber(recipe.outputRate);
    if (rate !== null && rate > 0) {
      recipe.craftTime = normalizeNumericString(String(primary.qtyNum * 60 / rate), 6);
    }
  }
}

function analyzeTopologyDistribution(totalFlow, targetBelts, allowedSizes, preferredDepth = 4) {
  const sizes = allowedSizes.filter((size) => Number.isInteger(size) && size > 1);
  if (targetBelts <= 0) {
    return { exact: true, depth: 0, microBranches: 0, rates: [], imbalance: 0, details: "No branches." };
  }

  if (!sizes.length) {
    const equal = Array.from({ length: targetBelts }, () => totalFlow / targetBelts);
    return {
      exact: targetBelts === 1,
      depth: 0,
      microBranches: targetBelts,
      rates: equal,
      imbalance: 0,
      details: targetBelts === 1 ? "No split needed." : "No valid splitter or merger sizes defined."
    };
  }

  const candidates = new Map([[1, 0]]);
  let frontier = new Map([[1, 0]]);
  for (let depth = 1; depth <= HARD_NETWORK_DEPTH; depth++) {
    const next = new Map();
    frontier.forEach((_, count) => {
      sizes.forEach((size) => {
        const candidate = count * size;
        if (candidate > 256) return;
        if (!candidates.has(candidate)) candidates.set(candidate, depth);
        if (!next.has(candidate)) next.set(candidate, depth);
      });
    });
    frontier = next;
  }

  const exactDepth = candidates.has(targetBelts) ? candidates.get(targetBelts) : null;
  if (exactDepth !== null && exactDepth <= HARD_NETWORK_DEPTH) {
    return {
      exact: true,
      depth: exactDepth,
      microBranches: targetBelts,
      rates: Array.from({ length: targetBelts }, () => totalFlow / targetBelts),
      imbalance: 0,
      details: `Exact topology available at depth ${exactDepth}.`
    };
  }

  const reachable = [...candidates.entries()]
    .map(([count, depth]) => ({ count, depth }))
    .filter((entry) => entry.count >= targetBelts)
    .sort((a, b) => a.count - b.count || a.depth - b.depth);

  let best = null;
  reachable.forEach((candidate) => {
    const base = Math.floor(candidate.count / targetBelts);
    const remainder = candidate.count % targetBelts;
    const rates = Array.from({ length: targetBelts }, (_, index) => {
      const pieces = index < remainder ? base + 1 : base;
      return totalFlow * pieces / candidate.count;
    });
    const imbalance = rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
    const depthPenalty = candidate.depth > preferredDepth ? 1000 : 0;
    const score = imbalance * 100000 + depthPenalty + candidate.depth * 10 + candidate.count / 1000;
    if (!best || score < best.score) best = { ...candidate, rates, imbalance, score };
  });

  if (!best) {
    return {
      exact: false,
      depth: HARD_NETWORK_DEPTH,
      microBranches: 0,
      rates: Array.from({ length: targetBelts }, () => 0),
      imbalance: 0,
      details: "No feasible topology within depth limits."
    };
  }

  return {
    exact: false,
    depth: best.depth,
    microBranches: best.count,
    rates: best.rates,
    imbalance: best.imbalance,
    details: `Balanced approximation using ${best.count} micro-branches at depth ${best.depth}.`
  };
}

function buildGraphAnalysis() {
  const roleState = deriveItemRoles();
  const items = roleState.items;
  const itemMap = roleState.itemMap;
  const settings = getSettingsNumbers();
  const edges = state.processRows
    .filter(isValidProcessRow)
    .map((row, index) => ({
      rowId: row.id,
      source: row.inputItemId,
      target: row.outputItemId,
      index: index + 1,
      flow: 0,
      exact: true,
      approx: null,
      merge: false
    }));

  const incoming = new Map();
  const outgoing = new Map();
  const definedIds = new Set(items.map((item) => item.id));
  definedIds.forEach((id) => {
    incoming.set(id, []);
    outgoing.set(id, []);
  });

  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  });

  const externalFlows = {};
  items.forEach((item) => {
    externalFlows[item.id] = item.belts
      .map((belt) => parseNumber(belt.value))
      .filter((num) => num !== null && num >= 0)
      .reduce((sum, num) => sum + num, 0);
  });

  const indegree = new Map();
  definedIds.forEach((id) => indegree.set(id, 0));
  edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1));

  const queue = [];
  indegree.forEach((value, key) => { if (value === 0) queue.push(key); });

  const order = [];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    (outgoing.get(current) || []).forEach((edge) => {
      indegree.set(edge.target, indegree.get(edge.target) - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    });
  }

  const hasCycle = order.length < definedIds.size && edges.length > 0;
  if (hasCycle) definedIds.forEach((id) => { if (!order.includes(id)) order.push(id); });

  const totalFlows = {};
  definedIds.forEach((id) => totalFlows[id] = externalFlows[id] || 0);

  const splitAnalyses = [];
  const mergeAnalyses = [];

  order.forEach((itemId) => {
    const sourceTotal = totalFlows[itemId] || 0;
    const sourceEdges = outgoing.get(itemId) || [];
    if (!sourceEdges.length) return;
    const distribution = analyzeTopologyDistribution(sourceTotal, sourceEdges.length, settings.splitterSizes, MAX_NETWORK_DEPTH);
    sourceEdges.forEach((edge, index) => {
      edge.flow = distribution.rates[index] || 0;
      edge.exact = distribution.exact;
      edge.approx = distribution;
      totalFlows[edge.target] = (totalFlows[edge.target] || 0) + edge.flow;
    });
    splitAnalyses.push({
      itemId,
      itemName: itemMap.get(itemId)?.name || "Unknown",
      totalFlow: sourceTotal,
      outputs: sourceEdges.length,
      ...distribution
    });
  });

  edges.forEach((edge) => { edge.merge = (incoming.get(edge.target) || []).length > 1; });

  incoming.forEach((list, itemId) => {
    if (list.length > 1) {
      const total = list.reduce((sum, edge) => sum + edge.flow, 0);
      mergeAnalyses.push({
        itemId,
        itemName: itemMap.get(itemId)?.name || "Unknown",
        inputs: list.length,
        totalFlow: total,
        ...analyzeTopologyDistribution(total, list.length, settings.mergerSizes, MAX_NETWORK_DEPTH)
      });
    }
  });

  return {
    items,
    itemMap,
    roleState,
    edges,
    incoming,
    outgoing,
    externalFlows,
    totalFlows,
    hasCycle,
    splitAnalyses,
    mergeAnalyses,
    exactRouting: !hasCycle && splitAnalyses.every((entry) => entry.exact) && mergeAnalyses.every((entry) => entry.exact),
    approximateNeeded: hasCycle || splitAnalyses.some((entry) => !entry.exact) || mergeAnalyses.some((entry) => !entry.exact)
  };
}

function buildRecipeAnalysis(graph) {
  const settings = getSettingsNumbers();
  const analyses = [];
  let totalPower = 0;

  state.recipes.forEach((recipe) => {
    const { inputs, outputs } = getValidRecipeEntries(recipe, graph.itemMap);
    if (!recipe.name.trim() && !inputs.length && !outputs.length && !recipe.outputRate && !recipe.craftTime && !recipe.power) return;

    const power100 = parseNumber(recipe.power) ?? 0;
    const desiredOutput = parseNumber(recipe.outputRate);
    const craftTime = parseNumber(recipe.craftTime);
    const primary = outputs[0];
    const warnings = [];
    if (!recipe.name.trim()) warnings.push("Machine class label missing.");
    if (!inputs.length) warnings.push("No valid input items.");
    if (!outputs.length) warnings.push("No valid output items.");
    if (!primary) {
      analyses.push({ id: recipe.id, name: recipe.name.trim() || "Unnamed machine", warnings, valid: false });
      return;
    }

    let baseOutputRate = null;
    if (craftTime !== null && craftTime > 0) baseOutputRate = primary.qtyNum * 60 / craftTime;
    else if (desiredOutput !== null && desiredOutput > 0) baseOutputRate = desiredOutput;
    if (baseOutputRate === null || baseOutputRate <= 0) {
      warnings.push("Primary output rate is not calculable.");
      analyses.push({ id: recipe.id, name: recipe.name.trim() || "Unnamed machine", warnings, valid: false });
      return;
    }

    const supportCandidates = inputs.map((input) => {
      const available = graph.totalFlows[input.itemId] || 0;
      return {
        itemId: input.itemId,
        itemName: graph.itemMap.get(input.itemId)?.name || "Unknown",
        qty: input.qtyNum,
        available,
        maxCrafts: input.qtyNum > 0 ? available / input.qtyNum : 0
      };
    });

    const maxCraftsByInputs = supportCandidates.length ? Math.min(...supportCandidates.map((entry) => entry.maxCrafts)) : Number.POSITIVE_INFINITY;
    const maxOutputFromInputs = Number.isFinite(maxCraftsByInputs) ? maxCraftsByInputs * primary.qtyNum : desiredOutput ?? baseOutputRate;
    const requestedOutput = desiredOutput ?? baseOutputRate;
    const actualOutput = Math.max(0, Math.min(requestedOutput, maxOutputFromInputs));
    const bottleneck = supportCandidates.length
      ? supportCandidates.reduce((lowest, current) => current.maxCrafts < lowest.maxCrafts ? current : lowest, supportCandidates[0])
      : null;

    let machineCount = actualOutput > 0 ? 1 : 0;
    let clock = actualOutput > 0 ? ceilTwoDecimals(actualOutput / baseOutputRate * 100) : 0;
    while (machineCount > 0 && clock > settings.maxClock) {
      machineCount += 1;
      clock = ceilTwoDecimals(actualOutput / (baseOutputRate * machineCount) * 100);
    }
    if (machineCount > 0 && clock < settings.minClock) {
      warnings.push(`Required clock ${fmt(clock)}% is below the allowed minimum ${fmt(settings.minClock)}%.`);
    }

    const powerUse = machineCount * power100 * (clock / 100);
    totalPower += powerUse;
    if (actualOutput < requestedOutput) {
      warnings.push(bottleneck
        ? `Bottleneck: ${bottleneck.itemName} limits this machine to ${fmt(actualOutput)} item/min output.`
        : "Output limited by available inputs.");
    }

    analyses.push({
      id: recipe.id,
      name: recipe.name.trim() || "Unnamed machine",
      valid: true,
      warnings,
      inputs,
      outputs,
      baseOutputRate,
      requestedOutput,
      actualOutput,
      machineCount,
      clock,
      powerUse,
      bottleneck,
      power100,
      craftTime: craftTime ?? (primary.qtyNum * 60 / baseOutputRate)
    });
  });

  return { analyses, totalPower, withinPower: totalPower <= settings.maxPower };
}

function buildSummary() {
  const graph = buildGraphAnalysis();
  const recipes = buildRecipeAnalysis(graph);
  const settings = getSettingsNumbers();
  const warnings = [];
  const errors = [];
  const duplicateNames = findDuplicateItemNames(graph.items);
  if (duplicateNames.length) warnings.push(`Duplicate item names: ${duplicateNames.join(", ")}.`);
  if (graph.hasCycle) warnings.push("Cycle detected in process graph. Flow propagation uses a non-cyclic fallback order.");
  if (!graph.exactRouting && graph.approximateNeeded) warnings.push("Some split or merge topologies require balanced approximation.");
  if (!recipes.withinPower) warnings.push(`Power limit exceeded by ${fmt(recipes.totalPower - settings.maxPower)} MW.`);
  graph.splitAnalyses.forEach((entry) => { if (!entry.exact) warnings.push(`${entry.itemName} split to ${entry.outputs} outputs is approximate: imbalance ${fmt(entry.imbalance)} item/min.`); });
  graph.mergeAnalyses.forEach((entry) => { if (!entry.exact) warnings.push(`${entry.itemName} merge from ${entry.inputs} inputs is approximate within allowed merger sizes.`); });

  graph.roleState.invalidIds.forEach((itemId) => {
    const itemName = graph.itemMap.get(itemId)?.name || "Unknown";
    errors.push(`${itemName} is referenced but has neither belt input nor any producing recipe.`);
  });

  state.processRows
    .filter(isValidProcessRow)
    .forEach((row) => {
      const inputName = graph.itemMap.get(row.inputItemId)?.name || "Unknown";
      const outputName = graph.itemMap.get(row.outputItemId)?.name || "Unknown";
      if (!graph.roleState.validSourceIds.has(row.inputItemId)) {
        errors.push(`Process input ${inputName} has no valid source. It must come from belts or a producing recipe.`);
      }
      if (!graph.roleState.producedIds.has(row.outputItemId)) {
        errors.push(`Process output ${outputName} is invalid because no recipe produces it.`);
      }
    });

  state.recipes.forEach((recipe) => {
    recipe.inputs.forEach((row) => {
      if (!row.itemId || !graph.itemMap.has(row.itemId)) return;
      const itemName = graph.itemMap.get(row.itemId)?.name || "Unknown";
      if (!graph.roleState.validSourceIds.has(row.itemId)) {
        errors.push(`Recipe input ${itemName} has no valid source. Add belt input or a producing recipe.`);
      }
    });
  });

  return { graph, recipes, settings, warnings, errors };
}

function layoutGraph(summary) {
  const { graph } = summary;
  const nodes = new Map();
  const relevantIds = new Set();
  graph.edges.forEach((edge) => {
    relevantIds.add(edge.source);
    relevantIds.add(edge.target);
  });

  if (!relevantIds.size) {
    return { nodes, edges: graph.edges, width: 1200, height: 480, machinesY: 340 };
  }

  const parents = new Map();
  const children = new Map();
  relevantIds.forEach((id) => {
    parents.set(id, []);
    children.set(id, []);
  });
  graph.edges.forEach((edge) => {
    parents.get(edge.target)?.push(edge.source);
    children.get(edge.source)?.push(edge.target);
  });

  const memo = new Map();
  const stack = new Set();
  function levelOf(id) {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const p = parents.get(id) || [];
    let level = 0;
    if (p.length === 1) level = levelOf(p[0]) + 1;
    else if (p.length > 1) level = Math.max(...p.map(levelOf)) + 1;
    stack.delete(id);
    memo.set(id, level);
    return level;
  }

  relevantIds.forEach((id) => levelOf(id));

  const groups = new Map();
  relevantIds.forEach((id) => {
    const level = memo.get(id) || 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(id);
  });

  const levels = [...groups.keys()].sort((a, b) => a - b);
  const columnSpacing = 250;
  const rowSpacing = 120;
  const nodeWidth = 170;
  const nodeHeight = 62;
  const positions = new Map();
  let maxY = 100;

  levels.forEach((level) => {
    const ids = groups.get(level);
    ids.sort((a, b) => {
      const pa = parents.get(a) || [];
      const pb = parents.get(b) || [];
      const avgA = pa.length ? pa.reduce((sum, id) => sum + (positions.get(id)?.y || 80), 0) / pa.length : 80;
      const avgB = pb.length ? pb.reduce((sum, id) => sum + (positions.get(id)?.y || 80), 0) / pb.length : 80;
      return avgA - avgB || (graph.itemMap.get(a)?.name || "").localeCompare(graph.itemMap.get(b)?.name || "");
    });

    ids.forEach((id, index) => {
      const p = parents.get(id) || [];
      let y;
      if (!p.length) {
        y = 90 + index * rowSpacing;
      } else if (p.length === 1) {
        const parentPos = positions.get(p[0]);
        const siblings = (children.get(p[0]) || []).length;
        if (siblings === 1) {
          y = parentPos ? parentPos.y : 90 + index * rowSpacing;
        } else {
          const childIds = (children.get(p[0]) || []).slice().sort();
          const siblingIndex = childIds.indexOf(id);
          const offset = (siblingIndex - (siblings - 1) / 2) * 90;
          y = (parentPos ? parentPos.y : 90) + offset;
        }
      } else {
        const average = p.reduce((sum, parentId) => sum + (positions.get(parentId)?.y || 90), 0) / p.length;
        y = average + 60;
      }
      positions.set(id, { x: 90 + level * columnSpacing, y, width: nodeWidth, height: nodeHeight });
      maxY = Math.max(maxY, y + nodeHeight / 2 + 30);
    });
  });

  const width = Math.max(1200, levels.length * columnSpacing + 340);
  const machinesY = maxY + 70;
  const machineRows = Math.ceil(summary.recipes.analyses.length / 4);
  const height = Math.max(480, machinesY + machineRows * 90 + 80);

  relevantIds.forEach((id) => {
    const item = graph.itemMap.get(id);
    nodes.set(id, {
      ...positions.get(id),
      id,
      name: item?.name || "Unknown",
      color: item?.color || "#888",
      totalFlow: graph.totalFlows[id] || 0,
      externalFlow: graph.externalFlows[id] || 0
    });
  });

  return { nodes, edges: graph.edges, width, height, machinesY };
}

function edgePath(sourceNode, targetNode) {
  return `M ${sourceNode.x + sourceNode.width} ${sourceNode.y} L ${targetNode.x} ${targetNode.y}`;
}

function renderBoard(summary) {
  const layout = layoutGraph(summary);
  const { nodes, edges, width, height, machinesY } = layout;
  if (!edges.length) {
    return `
      <svg viewBox="0 0 1200 480" role="img" aria-label="Visual network board">
        <text x="600" y="200" text-anchor="middle" class="board-placeholder">No network yet</text>
        <text x="600" y="230" text-anchor="middle" class="board-placeholder-sub">Define items, recipes, and process links above. The board stays live and ready.</text>
      </svg>
    `;
  }

  let svg = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Visual network board">
      <defs>
        <marker id="arrow-head" markerWidth="12" markerHeight="8" refX="10" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L12,4 L0,8 z" fill="#4b4234"></path>
        </marker>
      </defs>
  `;

  edges.forEach((edge) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) return;
    const stroke = summary.graph.items.length === 1 ? "#111" : (source.color || "#111");
    const labelColor = contrastColor(stroke);
    const path = edgePath(source, target);
    const midX = (source.x + source.width + target.x) / 2;
    const midY = (source.y + target.y) / 2 - 8;
    const label = `B${edge.index} · ${fmt(edge.flow)} /min`;
    if (edge.merge) {
      svg += `
        <g class="merge-group" data-delete-row="${edge.rowId}">
          <path class="edge-outline" d="${path}" fill="none" stroke="transparent" stroke-width="1"></path>
          <path class="edge-main" d="${path}" fill="none" stroke="${stroke}" stroke-width="2.2" marker-end="url(#arrow-head)"></path>
          <path class="edge-hit" d="${path}" data-delete-row="${edge.rowId}"></path>
          <text x="${midX}" y="${midY}" text-anchor="middle" class="edge-label" fill="${labelColor}">${escapeHtml(label)}</text>
        </g>
      `;
    } else {
      svg += `
        <g>
          <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.2" marker-end="url(#arrow-head)"></path>
          <text x="${midX}" y="${midY}" text-anchor="middle" class="edge-label" fill="${labelColor}">${escapeHtml(label)}</text>
        </g>
      `;
    }
  });

  nodes.forEach((node) => {
    svg += `
      <g class="graph-node">
        <rect x="${node.x}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}"></rect>
        <rect class="accent" x="${node.x}" y="${node.y - node.height / 2}" width="10" height="${node.height}" fill="${escapeHtml(node.color)}"></rect>
        <text x="${node.x + 20}" y="${node.y - 7}" class="graph-label">${escapeHtml(node.name)}</text>
        <text x="${node.x + 20}" y="${node.y + 13}" class="graph-sub">Total ${escapeHtml(fmt(node.totalFlow))} item/min</text>
        <text x="${node.x + 20}" y="${node.y + 28}" class="graph-sub">Input ${escapeHtml(fmt(node.externalFlow))} item/min</text>
      </g>
    `;
  });

  summary.recipes.analyses.forEach((recipe, index) => {
    const x = 80 + (index % 4) * 270;
    const y = machinesY + Math.floor(index / 4) * 86;
    svg += `
      <g class="machine-box">
        <rect x="${x}" y="${y}" width="230" height="56"></rect>
        <text x="${x + 12}" y="${y + 22}">${escapeHtml(recipe.name)}</text>
        <text x="${x + 12}" y="${y + 40}">${escapeHtml(`${recipe.machineCount || 0}x · ${fmt(recipe.clock || 0)}% · ${fmt(recipe.actualOutput || 0)} /min`)}</text>
      </g>
    `;
  });

  return `${svg}</svg>`;
}

function renderColorPicker() {
  const root = document.getElementById("color-picker-root");
  if (!root) return;
  const targetRow = state.itemRows.find((entry) => entry.id === colorPickerState.targetItemId);
  if (colorPickerState.open && (!targetRow || colorPickerState.targetField !== "color")) {
    colorPickerState.open = false;
    colorPickerState.targetItemId = "";
  }
  if (!colorPickerState.open) {
    root.innerHTML = "";
    return;
  }

  const hueRgb = hsvToRgb(colorPickerState.hue, 100, 100);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const svLeft = `${colorPickerState.sat}%`;
  const svTop = `${100 - colorPickerState.val}%`;
  const hueTop = `${(colorPickerState.hue / 360) * 100}%`;
  const rgb = hexToRgb(colorPickerState.draftHex);

  root.innerHTML = `
    <div class="color-picker-backdrop" data-color-picker-close="backdrop"></div>
    <div class="color-picker-popup" role="dialog" aria-modal="true" aria-label="Color picker">
      <div class="color-picker-topbar">
        <strong>Color Picker</strong>
        <span class="pill" data-color-picker-pill>${escapeHtml(colorPickerState.draftHex)}</span>
      </div>
      <div class="color-picker-layout">
        <div class="color-sv-area" data-color-picker-sv style="background:${escapeHtml(hueColor)}">
          <div class="color-sv-white"></div>
          <div class="color-sv-black"></div>
          <div class="color-picker-handle" style="left:${svLeft};top:${svTop};"></div>
        </div>
        <div class="color-hue-area" data-color-picker-hue>
          <div class="color-hue-gradient"></div>
          <div class="color-hue-handle" style="top:${hueTop};"></div>
        </div>
      </div>
      <div class="color-picker-meta">
        <div class="color-preview-box" style="background:${escapeHtml(colorPickerState.draftHex)}"></div>
        <div class="color-value-readout">
          <div>HEX: <span data-color-picker-hex>${escapeHtml(colorPickerState.draftHex)}</span></div>
          <div>RGB: <span data-color-picker-rgb>${rgb.r}, ${rgb.g}, ${rgb.b}</span></div>
        </div>
      </div>
      <div class="color-picker-actions">
        <button type="button" class="secondary" data-color-picker-close="cancel">Cancel</button>
        <button type="button" data-color-picker-apply="apply">Apply</button>
      </div>
    </div>
  `;

  attachColorPickerEvents();
}

function syncColorPickerUi(container = document) {
  const svArea = container.querySelector("[data-color-picker-sv]");
  const hueArea = container.querySelector("[data-color-picker-hue]");
  const svHandle = container.querySelector(".color-picker-handle");
  const hueHandle = container.querySelector(".color-hue-handle");
  const preview = container.querySelector(".color-preview-box");
  const pill = container.querySelector("[data-color-picker-pill]");
  const hexValue = container.querySelector("[data-color-picker-hex]");
  const rgbValue = container.querySelector("[data-color-picker-rgb]");
  if (!svArea || !hueArea || !svHandle || !hueHandle || !preview || !pill || !hexValue || !rgbValue) return;

  const hueRgb = hsvToRgb(colorPickerState.hue, 100, 100);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const rgb = hexToRgb(colorPickerState.draftHex);

  svArea.style.background = hueColor;
  svHandle.style.left = `${colorPickerState.sat}%`;
  svHandle.style.top = `${100 - colorPickerState.val}%`;
  hueHandle.style.top = `${(colorPickerState.hue / 360) * 100}%`;
  preview.style.background = colorPickerState.draftHex;
  pill.textContent = colorPickerState.draftHex;
  hexValue.textContent = colorPickerState.draftHex;
  rgbValue.textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

function attachColorPickerEvents() {
  const root = document.getElementById("color-picker-root");
  if (!root) return;

  root.querySelectorAll("[data-color-picker-close]").forEach((element) => {
    element.onclick = () => closeColorPicker();
  });

  const applyButton = root.querySelector("[data-color-picker-apply]");
  if (applyButton) applyButton.onclick = () => applyColorPicker();

  const bindDrag = (element, updater) => {
    if (!element) return;
    element.onpointerdown = (event) => {
      event.preventDefault();
      if (typeof element.setPointerCapture === "function") element.setPointerCapture(event.pointerId);

      const move = (clientX, clientY) => {
        updater(clientX, clientY);
        updateColorPickerDraft();
        syncColorPickerUi(root);
      };

      move(event.clientX, event.clientY);

      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        move(moveEvent.clientX, moveEvent.clientY);
      };

      const stop = (endEvent) => {
        if (endEvent.pointerId !== event.pointerId) return;
        if (typeof element.releasePointerCapture === "function" && element.hasPointerCapture?.(endEvent.pointerId)) {
          element.releasePointerCapture(endEvent.pointerId);
        }
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", stop);
        element.removeEventListener("pointercancel", stop);
      };

      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerup", stop);
      element.addEventListener("pointercancel", stop);
    };
  };

  bindDrag(root.querySelector("[data-color-picker-sv]"), (clientX, clientY) => {
    const rect = root.querySelector("[data-color-picker-sv]").getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    colorPickerState.sat = rect.width ? (x / rect.width) * 100 : 0;
    colorPickerState.val = rect.height ? 100 - (y / rect.height) * 100 : 0;
  });

  bindDrag(root.querySelector("[data-color-picker-hue]"), (clientX, clientY) => {
    const rect = root.querySelector("[data-color-picker-hue]").getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    colorPickerState.hue = rect.height ? (y / rect.height) * 360 : 0;
  });

  syncColorPickerUi(root);
}

function render() {
  ensureTrailingStructures();
  sanitizeReferences();
  saveLocal();

  const summary = buildSummary();
  const items = summary.graph.items;
  const roleState = summary.graph.roleState;
  const itemRowStatuses = getItemRowStatuses();
  const duplicateNames = findDuplicateItemNames(items);
  const clockMin = getClockSliderValue(state.settings.clockMin || 1);
  const clockMax = Math.max(clockMin, getClockSliderValue(state.settings.clockMax || 250));
  const sliderLeft = ((clockMin - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const sliderRight = ((clockMax - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const recipeInputItems = items.filter((item) => roleState.recipeInputSelectableIds.includes(item.id));
  const recipeOutputItems = items;
  const processInputItems = items.filter((item) => roleState.processInputSelectableIds.includes(item.id));
  const processOutputItems = items.filter((item) => roleState.processOutputSelectableIds.includes(item.id));
  const beltSpeedOptions = summary.settings.beltSpeeds.map((speed) => String(speed));

  document.getElementById("app").innerHTML = `
    <div class="top-area">
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="toolbar-title">FlowForge</div>
          <span class="pill">${items.length} items</span>
          <span class="pill">${summary.graph.edges.length} graph links</span>
          <span class="pill">${summary.recipes.analyses.length} machine classes</span>
        </div>
        <div class="toolbar-right">
          <button type="button" data-action="save-json">Save JSON</button>
          <button type="button" class="secondary" data-action="load-json">Load JSON</button>
          <button type="button" class="secondary" data-action="reset-all">Reset</button>
          <input type="file" id="json-loader" accept="application/json">
        </div>
      </div>

      <div class="control-grid">
        <section class="panel">
          <h2>Item Definitions</h2>
          <div class="stack">
            ${state.itemRows.map((row, index) => `
              <div class="item-row ${itemRowStatuses.get(row.id)?.valid ? "valid" : ""}">
                <div class="row cols-4">
                  <div>
                    <label class="field-label">Item name</label>
                    <input type="text" value="${escapeHtml(row.name)}" placeholder="Define item name" data-item-field="name" data-item-id="${row.id}">
                  </div>
                  <div>
                    <label class="field-label">Item color</label>
                    <input type="text" value="${escapeHtml(row.color)}" placeholder="#ff8800 or tomato" data-item-field="color" data-item-id="${row.id}">
                  </div>
                  <div>
                    <label class="field-label">Color</label>
                    <button type="button" class="secondary" data-item-random="${row.id}">Random</button>
                  </div>
                  <div>
                    <label class="field-label">Picker</label>
                    <button type="button" class="secondary icon-button" data-item-picker="${row.id}" aria-label="Open color picker">◉</button>
                  </div>
                </div>
                <div class="footnote">
                  ${itemRowStatuses.get(row.id)?.valid
                    ? `Registered as <strong>${escapeHtml(row.name.trim())}</strong>.`
                    : index === state.itemRows.length - 1
                      ? "Leave one empty row available for the next item."
                      : "Provide a unique name and a unique valid CSS color."}
                </div>
              </div>
            `).join("")}
          </div>
          ${duplicateNames.length ? `<div class="footnote danger-text" style="margin-top:8px">Duplicate item names disable clean references: ${escapeHtml(duplicateNames.join(", "))}.</div>` : ""}

          <h3>Item Cards</h3>
          <div class="item-card-grid">
            ${items.length ? items.map((item) => `
              <div class="item-card" style="--item-color:${escapeHtml(item.color)}">
                <div class="item-card-header">
                  <div class="item-name">${escapeHtml(item.name)}</div>
                  <div class="color-chip" style="background:${escapeHtml(item.color)}"></div>
                </div>
                <div class="subtle">Input belts</div>
                <div class="belt-rows">
                  ${item.belts.map((belt) => `
                    <div class="belt-row">
                      <select data-belt-item="${item.id}" data-belt-id="${belt.id}">
                        <option value=""></option>
                        ${beltSpeedOptions.map((speed) => `<option value="${escapeHtml(speed)}" ${speed === String(belt.value) ? "selected" : ""}>${escapeHtml(speed)}</option>`).join("")}
                      </select>
                      <span class="unit">item/min</span>
                    </div>
                  `).join("")}
                </div>
              </div>
            `).join("") : `
              <div class="item-card" style="--item-color:#777">
                <div class="item-card-header"><div class="item-name">No items yet</div><div class="color-chip" style="background:#777"></div></div>
                <div class="subtle">Define an item above to unlock belt inputs, recipe dropdowns, and graph nodes.</div>
              </div>
            `}
          </div>
        </section>

        <section class="panel">
          <h2>Global Settings</h2>
          <div class="settings-grid">
            <div><label class="field-label">Available belt speeds</label><input type="text" value="${escapeHtml(state.settings.beltSpeeds)}" data-setting="beltSpeeds"></div>
            <div><label class="field-label">Allowed splitter sizes</label><input type="text" value="${escapeHtml(state.settings.splitterSizes)}" data-setting="splitterSizes"></div>
            <div><label class="field-label">Allowed merger sizes</label><input type="text" value="${escapeHtml(state.settings.mergerSizes)}" data-setting="mergerSizes"></div>
            <div><label class="field-label">Maximum available power</label><input type="text" value="${escapeHtml(state.settings.maxPower)}" data-setting="maxPower"></div>
            <div class="clock-panel">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <strong>Clock speed interval</strong>
                <span class="pill">${fmt(summary.settings.minClock)}% to ${fmt(summary.settings.maxClock)}%</span>
              </div>
              <div class="dual-slider">
                <div class="dual-slider-track"></div>
                <div class="dual-slider-fill" style="left:${sliderLeft}%;right:${100 - sliderRight}%"></div>
                <input type="range" min="${CLOCK_SLIDER_MIN}" max="${CLOCK_SLIDER_MAX}" step="${CLOCK_STEP}" value="${escapeHtml(String(clockMin))}" data-clock-slider="min">
                <input type="range" min="${CLOCK_SLIDER_MIN}" max="${CLOCK_SLIDER_MAX}" step="${CLOCK_STEP}" value="${escapeHtml(String(clockMax))}" data-clock-slider="max">
              </div>
              <div class="clock-values">
                <div><label class="field-label">Minimum allowed clock</label><input type="text" value="${escapeHtml(state.settings.clockMin)}" data-setting="clockMin"></div>
                <div><label class="field-label">Maximum allowed clock</label><input type="text" value="${escapeHtml(state.settings.clockMax)}" data-setting="clockMax"></div>
              </div>
              <div class="footnote">Clock is always positive, supports decimals, and never calculates with 0%.</div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Result Summary</h2>
          <div class="summary-list">
            <div class="stat-row"><div>Exact routing</div><div class="value ${summary.graph.exactRouting ? "ok-text" : "warning-text"}">${summary.graph.exactRouting ? "Yes" : "No"}</div></div>
            <div class="stat-row"><div>Approximation needed</div><div class="value ${summary.graph.approximateNeeded ? "warning-text" : "ok-text"}">${summary.graph.approximateNeeded ? "Yes" : "No"}</div></div>
            <div class="stat-row"><div>Total machine power</div><div class="value ${summary.recipes.withinPower ? "" : "danger-text"}">${fmt(summary.recipes.totalPower)} / ${fmt(summary.settings.maxPower)} MW</div></div>
            <div class="stat-row"><div>Clock interval</div><div class="value">${fmt(summary.settings.minClock)}% to ${fmt(summary.settings.maxClock)}%</div></div>
          </div>

          <h3>Total Available Input</h3>
          <div class="summary-list">
            ${items.length ? items.map((item) => `<div class="stat-row"><div>${escapeHtml(item.name)}</div><div class="value">${fmt(summary.graph.totalFlows[item.id] || 0)} item/min</div></div>`).join("") : `<div class="footnote">No registered items yet.</div>`}
          </div>

          <h3>Warnings And Errors</h3>
          <div class="summary-list">
            ${summary.warnings.length
              ? summary.warnings.map((warning) => `<div class="mini-summary warning-text">${escapeHtml(warning)}</div>`).join("")
              : (summary.errors.length ? "" : `<div class="mini-summary ok-text">No active warnings. Routing and machine summaries are in a valid state.</div>`)}
            ${summary.errors.map((error) => `<div class="mini-summary danger-text">${escapeHtml(error)}</div>`).join("")}
          </div>
        </section>
      </div>

      <section class="recipes-shell">
        <div class="recipes-header">
          <div>
            <strong>Machine Classes / Recipes</strong>
            <div class="footnote">All recipe item references use dropdown selection only. Output rate and craft time stay synchronized on commit.</div>
          </div>
          <button type="button" class="secondary" data-action="add-recipe">Add Machine Class</button>
        </div>
        <div class="recipes-grid">
          ${state.recipes.map((recipe) => {
            const analysis = summary.recipes.analyses.find((entry) => entry.id === recipe.id);
            return `
              <div class="recipe-card">
                <div class="recipe-meta">
                  <div><label class="field-label">Machine class name</label><input type="text" value="${escapeHtml(recipe.name)}" placeholder="Smelter, Refinery, Mixer..." data-recipe-field="name" data-recipe-id="${recipe.id}"></div>
                  <div><label class="field-label">Output rate (item/min)</label><input type="text" value="${escapeHtml(recipe.outputRate)}" data-recipe-field="outputRate" data-recipe-id="${recipe.id}"></div>
                  <div><label class="field-label">Craft time (sec)</label><input type="text" value="${escapeHtml(recipe.craftTime)}" data-recipe-field="craftTime" data-recipe-id="${recipe.id}"></div>
                </div>
                <div class="recipe-meta" style="grid-template-columns:1fr 1fr auto">
                  <div><label class="field-label">Power at 100% clock</label><input type="text" value="${escapeHtml(recipe.power)}" data-recipe-field="power" data-recipe-id="${recipe.id}"></div>
                  <div class="mini-summary">
                    <strong>${analysis?.valid ? escapeHtml(analysis.name) : "Machine summary"}</strong><br>
                    ${analysis?.valid ? `${analysis.machineCount} machine(s) - ${fmt(analysis.clock)}% - ${fmt(analysis.actualOutput)} item/min` : "Waiting for valid IO and rate data."}
                  </div>
                  <div><button type="button" class="secondary" data-remove-recipe="${recipe.id}">Remove</button></div>
                </div>
                <div class="recipe-zones">
                  <div>
                    <label class="field-label">Inputs per craft</label>
                    <div class="recipe-io-list">
                      ${recipe.inputs.map((row) => `
                        <div class="io-row">
                          <select data-recipe-io="item" data-io-kind="input" data-recipe-id="${recipe.id}" data-io-id="${row.id}">
                            <option value="">Select input item</option>
                            ${recipeInputItems.map((item) => `<option value="${item.id}" ${item.id === row.itemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
                          </select>
                          <input type="text" value="${escapeHtml(row.qty)}" placeholder="Qty/craft" data-recipe-io="qty" data-io-kind="input" data-recipe-id="${recipe.id}" data-io-id="${row.id}">
                        </div>
                      `).join("")}
                    </div>
                  </div>
                  <div>
                    <label class="field-label">Outputs per craft</label>
                    <div class="recipe-io-list">
                      ${recipe.outputs.map((row) => `
                        <div class="io-row">
                          <select data-recipe-io="item" data-io-kind="output" data-recipe-id="${recipe.id}" data-io-id="${row.id}">
                            <option value="">Select output item</option>
                            ${recipeOutputItems.map((item) => `<option value="${item.id}" ${item.id === row.itemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
                          </select>
                          <input type="text" value="${escapeHtml(row.qty)}" placeholder="Qty/craft" data-recipe-io="qty" data-io-kind="output" data-recipe-id="${recipe.id}" data-io-id="${row.id}">
                        </div>
                      `).join("")}
                    </div>
                  </div>
                </div>
                ${analysis?.warnings?.length ? `<div class="summary-list" style="margin-top:10px">${analysis.warnings.map((warning) => `<div class="mini-summary warning-text">${escapeHtml(warning)}</div>`).join("")}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </section>

      <section class="process-shell">
        <div class="process-header">
          <div>
            <strong>Process Line / Graph Definition</strong>
            <div class="footnote">Rows auto-expand when valid. Merge edges on the board are directly deletable.</div>
          </div>
        </div>
        <div class="process-list">
          ${state.processRows.map((row) => `
            <div class="process-row">
              <select data-process-field="input" data-process-id="${row.id}">
                <option value="">Select input item</option>
                ${processInputItems.map((item) => `<option value="${item.id}" ${item.id === row.inputItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
              <div class="arrow-text">-&gt;</div>
              <select data-process-field="output" data-process-id="${row.id}">
                <option value="">Select output item</option>
                ${processOutputItems.map((item) => `<option value="${item.id}" ${item.id === row.outputItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </div>
          `).join("")}
        </div>
      </section>

      <div class="summary-strip">
        <div class="mini-summary">
          <h4>Split Feasibility</h4>
          ${summary.graph.splitAnalyses.length
            ? summary.graph.splitAnalyses.map((entry) => `<div class="footnote ${entry.exact ? "ok-text" : "warning-text"}">${escapeHtml(entry.itemName)}: ${entry.outputs} outputs, ${entry.exact ? "exact" : `approx, delta ${fmt(entry.imbalance)} /min`}</div>`).join("")
            : `<div class="footnote">No active split points.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Merge Feasibility</h4>
          ${summary.graph.mergeAnalyses.length
            ? summary.graph.mergeAnalyses.map((entry) => `<div class="footnote ${entry.exact ? "ok-text" : "warning-text"}">${escapeHtml(entry.itemName)}: ${entry.inputs} inputs, ${entry.exact ? "exact" : "approximate"}</div>`).join("")
            : `<div class="footnote">No active merges.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Machine Requirements</h4>
          ${summary.recipes.analyses.length
            ? summary.recipes.analyses.map((entry) => `<div class="footnote ${entry.valid ? "" : "warning-text"}">${escapeHtml(entry.name)}: ${entry.valid ? `${entry.machineCount} machine(s), ${fmt(entry.clock)}%` : "incomplete"}</div>`).join("")
            : `<div class="footnote">No machine classes defined.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Bottlenecks</h4>
          ${summary.recipes.analyses.filter((entry) => entry.bottleneck).length
            ? summary.recipes.analyses.filter((entry) => entry.bottleneck).map((entry) => `<div class="footnote warning-text">${escapeHtml(entry.name)} limited by ${escapeHtml(entry.bottleneck.itemName)}</div>`).join("")
            : `<div class="footnote">No input bottlenecks detected for current recipe requests.</div>`}
        </div>
      </div>
    </div>

    <section class="board-shell">
      <div class="board-header">
        <div>
          <strong>Visual Board</strong>
          <div class="footnote">SVG network view. Merge-created edges are hover-highlighted in red and delete immediately on click.</div>
        </div>
        <div class="toolbar-right">
          <span class="pill">${summary.graph.exactRouting ? "Exact topology" : "Balanced approximation active"}</span>
          <span class="pill">${summary.graph.edges.length} routed lines</span>
        </div>
      </div>
      <div class="board-stage">${renderBoard(summary)}</div>
    </section>
  `;

  attachEvents();
  renderColorPicker();
}

function commitSettings(normalizeStrings = true) {
  const min = Math.max(CLOCK_SLIDER_MIN, parseNumber(state.settings.clockMin) ?? 1);
  const max = Math.max(min, parseNumber(state.settings.clockMax) ?? 250);
  state.settings.clockMin = normalizeStrings ? normalizeNumericString(String(min), 2) : String(min);
  state.settings.clockMax = normalizeStrings ? normalizeNumericString(String(Math.min(max, CLOCK_SLIDER_MAX)), 2) : String(Math.min(max, CLOCK_SLIDER_MAX));
  if (normalizeStrings) {
    state.settings.beltSpeeds = formatListNumbers(parseListNumbers(state.settings.beltSpeeds, false));
    state.settings.splitterSizes = formatListNumbers(parseListNumbers(state.settings.splitterSizes, true));
    state.settings.mergerSizes = formatListNumbers(parseListNumbers(state.settings.mergerSizes, true));
    const maxPower = parseNumber(state.settings.maxPower);
    state.settings.maxPower = maxPower === null ? "" : normalizeNumericString(String(maxPower), 4);
  }
}

function syncClockSliderUi(container = document) {
  const minSlider = container.querySelector('[data-clock-slider="min"]');
  const maxSlider = container.querySelector('[data-clock-slider="max"]');
  const minInput = container.querySelector('[data-setting="clockMin"]');
  const maxInput = container.querySelector('[data-setting="clockMax"]');
  const fill = container.querySelector(".dual-slider-fill");
  if (!minSlider || !maxSlider || !minInput || !maxInput || !fill) return;

  const minSliderValue = getClockSliderValue(state.settings.clockMin);
  const maxSliderValue = Math.max(minSliderValue, getClockSliderValue(state.settings.clockMax));

  minSlider.value = String(minSliderValue);
  maxSlider.value = String(maxSliderValue);

  const sliderLeft = ((minSliderValue - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const sliderRight = ((maxSliderValue - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  fill.style.left = `${sliderLeft}%`;
  fill.style.right = `${100 - sliderRight}%`;
}

function commitRecipeField(recipe, field) {
  if (field === "name") {
    recipe.name = recipe.name.trimStart();
    return;
  }
  if (field === "power") {
    recipe.power = normalizeNumericString(recipe.power, 6);
    return;
  }
  if (field === "outputRate") {
    recipe.outputRate = normalizeNumericString(recipe.outputRate, 6);
    recipe.syncSource = "rate";
    syncRecipePair(recipe);
    return;
  }
  if (field === "craftTime") {
    recipe.craftTime = normalizeNumericString(recipe.craftTime, 6);
    recipe.syncSource = "time";
    syncRecipePair(recipe);
  }
}

function attachEvents() {
  const app = document.getElementById("app");
  const fileInput = document.getElementById("json-loader");

  app.querySelectorAll("[data-item-random]").forEach((button) => {
    button.onclick = () => {
      const row = state.itemRows.find((entry) => entry.id === button.dataset.itemRandom);
      if (!row) return;
      row.color = randomVisibleColor();
      ensureTrailingStructures();
      render();
    };
  });
  app.querySelectorAll("[data-item-field]").forEach((input) => {
    input.oninput = (event) => {
      const row = state.itemRows.find((entry) => entry.id === input.dataset.itemId);
      if (row) row[input.dataset.itemField] = event.target.value;
    };
    input.onblur = () => { ensureTrailingStructures(); render(); };
    input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } };
  });
  app.querySelectorAll("[data-belt-item]").forEach((input) => {
    input.onchange = (event) => {
      const row = state.itemRows.find((entry) => entry.id === input.dataset.beltItem);
      const belt = row?.belts.find((entry) => entry.id === input.dataset.beltId);
      if (!belt || !row) return;
      belt.value = event.target.value;
      ensureTrailingBelts(row);
      render();
    };
  });
  app.querySelectorAll("[data-item-picker]").forEach((button) => {
    button.onclick = () => {
      openColorPicker(button.dataset.itemPicker, "color");
    };
  });
  app.querySelectorAll("[data-setting]").forEach((input) => {
    input.oninput = (event) => { state.settings[input.dataset.setting] = event.target.value; };
    input.onblur = () => {
      commitSettings();
      sanitizeBeltSelections(state);
      render();
    };
    input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } };
  });
  app.querySelectorAll("[data-clock-slider]").forEach((input) => {
    input.step = String(CLOCK_STEP);
    input.onpointerdown = (event) => {
      if (typeof input.setPointerCapture === "function") input.setPointerCapture(event.pointerId);
    };
    input.oninput = (event) => {
      const value = getClockSliderValue(event.target.value);
      const currentMin = getClockSliderValue(state.settings.clockMin);
      const currentMax = getClockSliderValue(state.settings.clockMax);
      if (event.target.dataset.clockSlider === "min") {
        state.settings.clockMin = String(Math.min(value, currentMax));
      } else {
        state.settings.clockMax = String(Math.max(value, currentMin));
      }
      syncClockSliderUi(app);
      const minInput = app.querySelector('[data-setting="clockMin"]');
      const maxInput = app.querySelector('[data-setting="clockMax"]');
      if (minInput && maxInput) {
        minInput.value = String(getClockSliderValue(state.settings.clockMin));
        maxInput.value = String(getClockSliderValue(state.settings.clockMax));
      }
    };
    input.onpointerup = (event) => {
      if (typeof input.releasePointerCapture === "function" && input.hasPointerCapture?.(event.pointerId)) {
        input.releasePointerCapture(event.pointerId);
      }
      render();
    };
    input.onpointercancel = (event) => {
      if (typeof input.releasePointerCapture === "function" && input.hasPointerCapture?.(event.pointerId)) {
        input.releasePointerCapture(event.pointerId);
      }
      render();
    };
    input.onchange = () => {
      syncClockSliderUi(app);
      render();
    };
  });
  app.querySelectorAll("[data-recipe-field]").forEach((input) => {
    input.oninput = (event) => {
      const recipe = state.recipes.find((entry) => entry.id === input.dataset.recipeId);
      if (recipe) recipe[input.dataset.recipeField] = event.target.value;
    };
    input.onblur = () => {
      const recipe = state.recipes.find((entry) => entry.id === input.dataset.recipeId);
      if (!recipe) return;
      commitRecipeField(recipe, input.dataset.recipeField);
      render();
    };
    input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } };
  });
  app.querySelectorAll("[data-recipe-io]").forEach((input) => {
    input.oninput = (event) => {
      const recipe = state.recipes.find((entry) => entry.id === input.dataset.recipeId);
      if (!recipe) return;
      const list = input.dataset.ioKind === "input" ? recipe.inputs : recipe.outputs;
      const row = list.find((entry) => entry.id === input.dataset.ioId);
      if (!row) return;
      if (input.dataset.recipeIo === "item") row.itemId = event.target.value;
      else row.qty = event.target.value;
    };
    input.onchange = () => {
      const recipe = state.recipes.find((entry) => entry.id === input.dataset.recipeId);
      if (!recipe) return;
      if (input.dataset.recipeIo === "qty") {
        const list = input.dataset.ioKind === "input" ? recipe.inputs : recipe.outputs;
        const row = list.find((entry) => entry.id === input.dataset.ioId);
        if (row) row.qty = normalizeNumericString(row.qty, 6);
      }
      ensureTrailingIoRows(recipe.inputs, "rin");
      ensureTrailingIoRows(recipe.outputs, "rout");
      syncRecipePair(recipe);
      render();
    };
    input.onblur = input.onchange;
    input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } };
  });
  app.querySelectorAll("[data-remove-recipe]").forEach((button) => {
    button.onclick = () => {
      state.recipes = state.recipes.filter((entry) => entry.id !== button.dataset.removeRecipe);
      if (!state.recipes.length) state.recipes.push(emptyRecipe());
      render();
    };
  });
  app.querySelectorAll("[data-action='add-recipe']").forEach((button) => {
    button.onclick = () => { state.recipes.push(emptyRecipe()); render(); };
  });
  app.querySelectorAll("[data-process-field]").forEach((select) => {
    select.onchange = (event) => {
      const row = state.processRows.find((entry) => entry.id === select.dataset.processId);
      if (!row) return;
      if (select.dataset.processField === "input") row.inputItemId = event.target.value;
      else row.outputItemId = event.target.value;
      ensureTrailingStructures();
      render();
    };
  });
  app.querySelectorAll("[data-delete-row]").forEach((target) => {
    target.onclick = (event) => {
      const rowId = event.target.dataset.deleteRow || target.dataset.deleteRow;
      const row = state.processRows.find((entry) => entry.id === rowId);
      if (!row) return;
      row.outputItemId = "";
      ensureTrailingStructures();
      render();
    };
  });
  app.querySelectorAll("[data-action='save-json']").forEach((button) => {
    button.onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "flowforge-state.json";
      link.click();
      URL.revokeObjectURL(url);
    };
  });
  app.querySelectorAll("[data-action='load-json']").forEach((button) => { button.onclick = () => fileInput.click(); });
  if (fileInput) {
    fileInput.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        state = sanitizeState(JSON.parse(text));
        render();
      } catch (error) {
        alert("Invalid JSON file.");
      } finally {
        fileInput.value = "";
      }
    };
  }
  app.querySelectorAll("[data-action='reset-all']").forEach((button) => {
    button.onclick = () => { state = createDefaultState(); render(); };
  });

  syncClockSliderUi(app);
}

bindColorPickerGlobalEvents();
render();
