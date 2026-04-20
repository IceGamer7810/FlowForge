const APP_CONFIG = (() => {
  if (!window.FLOWFORGE_CONFIG) throw new Error("Missing config.json data.");
  return window.FLOWFORGE_CONFIG;
})();
const DEBUG_LOG_ENABLED = true;
const STORAGE_KEY = APP_CONFIG.storageKey;
const CLOCK_SLIDER_MIN = APP_CONFIG.clock.min;
const CLOCK_SLIDER_MAX = APP_CONFIG.clock.max;
const CLOCK_STEP = APP_CONFIG.clock.step;
const ROUTING_NODE_RADIUS = APP_CONFIG.geometry.routingNodeRadius;
const ROUTING_NODE_DIAMETER = ROUTING_NODE_RADIUS * 2;
const MACHINE_PORT_STEM = APP_CONFIG.geometry.machinePortStem;
const MACHINE_BASE_WIDTH = APP_CONFIG.geometry.machineBaseWidth;
const MACHINE_HEIGHT = APP_CONFIG.geometry.machineHeight;
const BELT_MIN_WIDTH = APP_CONFIG.belt.minWidth;
const BELT_LANE_SPACING = BELT_MIN_WIDTH * APP_CONFIG.belt.laneSpacingMultiplier;
const NODE_ARROW_PROTECTION = ROUTING_NODE_DIAMETER * (1 + APP_CONFIG.belt.protectedZoneDiameterMultiplier);

const uid = (() => {
  let i = 1;
  return (prefix) => `${prefix}-${i++}`;
})();

const colorContextCanvas = document.createElement("canvas").getContext("2d");

function debugLog(section, step, message, details) {
  if (!DEBUG_LOG_ENABLED) return;
  const prefix = `[${section}.${step}] ${message}`;
  if (typeof details === "undefined") {
    console.log(prefix);
    return;
  }
  console.log(prefix, details);
}

debugLog(1, 1, "App config loaded", APP_CONFIG);

function emptyBeltRow() {
  return { id: uid("belt"), value: "" };
}

function emptyItemRow() {
  return { id: uid("item"), name: "", color: "", belts: [emptyBeltRow()] };
}

function emptyMachineClassRow() {
  return { id: uid("machine"), name: "", power: "", inputCounts: "" };
}

function emptyRecipeInputRow() {
  return { id: uid("rin"), itemId: "", qty: "" };
}

function emptyRecipe() {
  return {
    id: uid("recipe"),
    inputs: [emptyRecipeInputRow()],
    outputItemId: "",
    outputQty: "",
    machineClassId: "",
    itemsPerMinute: ""
  };
}

function emptyBeltSpeedRow() {
  return { id: uid("speed"), speed: "", color: "" };
}

function defaultBeltSpeedRows() {
  return [
    ...APP_CONFIG.defaults.beltSpeeds.map((entry) => ({
      id: uid("speed"),
      speed: String(entry.speed),
      color: String(entry.color)
    })),
    emptyBeltSpeedRow()
  ];
}

function createDefaultState() {
  return {
    itemRows: [emptyItemRow()],
    machineClassRows: [emptyMachineClassRow()],
    recipes: [],
    settings: {
      beltSpeeds: defaultBeltSpeedRows(),
      maxPower: String(APP_CONFIG.defaults.maxPower),
      clockMin: String(APP_CONFIG.clock.defaultMin),
      clockMax: "100",
      enableOverflow: APP_CONFIG.defaults.enableOverflow,
      targetOutputItemId: "",
      targetOutputRate: String(APP_CONFIG.defaults.targetOutputRate)
    }
  };
}

function sanitizeState(input) {
  const base = createDefaultState();
  const rawSettings = { ...base.settings, ...(input.settings || {}) };
  const next = {
    itemRows: Array.isArray(input.itemRows) ? input.itemRows : base.itemRows,
    machineClassRows: Array.isArray(input.machineClassRows) ? input.machineClassRows : base.machineClassRows,
    recipes: Array.isArray(input.recipes) ? input.recipes : base.recipes,
    settings: {
      ...rawSettings,
      beltSpeeds: sanitizeBeltSpeedRowsInput(rawSettings.beltSpeeds)
    }
  };

  next.itemRows = next.itemRows.map((row) => ({
    id: row.id || uid("item"),
    name: String(row.name || ""),
    color: String(row.color || ""),
    belts: Array.isArray(row.belts) && row.belts.length
      ? row.belts.map((belt) => ({ id: belt.id || uid("belt"), value: String(belt.value ?? "") }))
      : [emptyBeltRow()]
  }));

  next.machineClassRows = next.machineClassRows.map((row) => ({
    id: row.id || uid("machine"),
    name: String(row.name || ""),
    power: String(row.power ?? ""),
    inputCounts: String(row.inputCounts ?? "")
  }));

  next.recipes = next.recipes.map((recipe) => ({
    id: recipe.id || uid("recipe"),
    inputs: Array.isArray(recipe.inputs) && recipe.inputs.length
      ? recipe.inputs.map((row) => ({ id: row.id || uid("rin"), itemId: String(row.itemId || ""), qty: String(row.qty ?? "") }))
      : [emptyRecipeInputRow()],
    outputItemId: String(recipe.outputItemId || ""),
    outputQty: String(recipe.outputQty ?? ""),
    machineClassId: String(recipe.machineClassId || ""),
    itemsPerMinute: String(recipe.itemsPerMinute ?? "")
  }));

  ensureStateStructure(next);
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

let recipeModalState = {
  open: false,
  recipeId: "",
  draft: emptyRecipe(),
  mode: "create"
};

let globalEventsBound = false;
let tooltipEventsBound = false;

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

function computeClockedPower(basePower, clockPercent) {
  if (!(basePower > 0) || !(clockPercent > 0)) return 0;
  return basePower * Math.pow(clockPercent / 100, APP_CONFIG.power.clockExponent);
}

function fmt(num, digits = 2) {
  if (!Number.isFinite(num)) return "0";
  return Number(num.toFixed(digits)).toString();
}

function formatListNumbers(values) {
  return values.map((value) => String(value)).join(", ");
}

function parseExactInputCounts(text) {
  return String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((num) => Number.isInteger(num) && num > 0)
    .filter((num, index, array) => array.indexOf(num) === index)
    .sort((a, b) => a - b);
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

function sanitizeBeltSpeedRowsInput(inputValue) {
  if (Array.isArray(inputValue)) {
    const rows = inputValue.map((row) => ({
      id: row.id || uid("speed"),
      speed: String(row.speed ?? ""),
      color: String(row.color ?? "")
    }));
    return rows.length ? rows : defaultBeltSpeedRows();
  }
  return defaultBeltSpeedRows();
}

function getClockSliderValue(value) {
  const parsed = parseNumber(String(value));
  if (parsed === null) return Math.round(CLOCK_SLIDER_MIN);
  return Math.max(Math.round(CLOCK_SLIDER_MIN), Math.min(Math.round(parsed), Math.round(CLOCK_SLIDER_MAX)));
}

function getSettingsNumbers(targetState = state) {
  const beltSpeeds = getDefinedBeltSpeeds(targetState);
  const splitterSizes = APP_CONFIG.routing.splitterSizes.slice();
  const mergerSizes = APP_CONFIG.routing.mergerSizes.slice();
  const maxPower = parseNumber(targetState.settings.maxPower) ?? 0;
  const minClock = Math.max(CLOCK_SLIDER_MIN, Math.min(parseNumber(targetState.settings.clockMin) ?? APP_CONFIG.clock.defaultMin, CLOCK_SLIDER_MAX));
  const maxClock = APP_CONFIG.clock.max;
  const enableOverflow = Boolean(targetState.settings.enableOverflow);
  const targetOutputRate = parseNumber(targetState.settings.targetOutputRate) ?? 0;
  return {
    beltSpeeds,
    splitterSizes,
    mergerSizes,
    maxPower,
    minClock,
    maxClock,
    enableOverflow,
    targetOutputItemId: targetState.settings.targetOutputItemId || "",
    targetOutputRate
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isValidColor(value) {
  if (!value.trim()) return false;
  const probe = new Option().style;
  probe.color = "";
  probe.color = value.trim();
  return probe.color !== "";
}

function randomVisibleColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 65 + Math.floor(Math.random() * 20);
  const l = 48 + Math.floor(Math.random() * 12);
  return `hsl(${h} ${s}% ${l}%)`;
}

function parseCssColorToHex(value) {
  colorContextCanvas.fillStyle = "#000000";
  colorContextCanvas.fillStyle = value;
  const normalized = colorContextCanvas.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toLowerCase();
  const match = normalized.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (!match) return "#ff0000";
  const [r, g, b] = match.slice(1).map((part) => Number(part));
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function contrastColor(color) {
  const normalized = parseCssColorToHex(color);
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
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
  ensureStateStructure();
  render();
}

function bindGlobalEvents() {
  if (globalEventsBound) return;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (colorPickerState.open) closeColorPicker();
      if (recipeModalState.open) closeRecipeModal();
    }
  });
  globalEventsBound = true;
}

function ensureFactoryTooltipRoot() {
  let root = document.getElementById("factory-tooltip-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "factory-tooltip-root";
    root.className = "factory-tooltip";
    document.body.appendChild(root);
  }
  return root;
}

function hideFactoryTooltip() {
  const root = ensureFactoryTooltipRoot();
  root.classList.remove("visible");
}

function showFactoryTooltip(text, clientX, clientY) {
  const root = ensureFactoryTooltipRoot();
  root.textContent = text;
  root.classList.add("visible");
  const width = root.offsetWidth || 0;
  root.style.left = `${Math.max(8, clientX - width - 14)}px`;
  root.style.top = `${clientY + 16}px`;
}

function bindFactoryTooltipEvents() {
  if (tooltipEventsBound) return;
  document.addEventListener("mousemove", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-factory-tooltip]") : null;
    if (!target) {
      hideFactoryTooltip();
      return;
    }
    showFactoryTooltip(target.getAttribute("data-factory-tooltip") || "", event.clientX, event.clientY);
  });
  document.addEventListener("mouseleave", hideFactoryTooltip);
  document.addEventListener("scroll", hideFactoryTooltip, true);
  tooltipEventsBound = true;
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
    statuses.set(row.id, {
      empty: isItemRowEmpty(row),
      valid: Boolean(nameKey && colorKey && isValidColor(row.color) && nameCounts.get(nameKey) === 1 && colorCounts.get(colorKey) === 1)
    });
  });
  return statuses;
}

function ensureItemRows(targetState = state) {
  const meaningfulRows = targetState.itemRows.filter((row) => !isItemRowEmpty(row));
  const statuses = getItemRowStatuses({ ...targetState, itemRows: meaningfulRows });
  const trimmed = [];
  for (const row of meaningfulRows) {
    trimmed.push(row);
    if (!statuses.get(row.id)?.valid) break;
  }
  targetState.itemRows = trimmed;
  const recalculated = getItemRowStatuses(targetState);
  const allValid = targetState.itemRows.length > 0 && targetState.itemRows.every((row) => recalculated.get(row.id)?.valid);
  if (!targetState.itemRows.length || allValid) targetState.itemRows.push(emptyItemRow());
}

function getMachineClassStatuses(targetState = state) {
  const meaningfulRows = targetState.machineClassRows.filter((row) => row.name.trim() || row.power.trim() || row.inputCounts.trim());
  const nameCounts = new Map();
  meaningfulRows.forEach((row) => {
    const key = row.name.trim().toLowerCase();
    if (key) nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  const statuses = new Map();
  targetState.machineClassRows.forEach((row) => {
    const key = row.name.trim().toLowerCase();
    const power = parseNumber(row.power);
    const allowedInputCounts = parseExactInputCounts(row.inputCounts);
    statuses.set(row.id, {
      empty: !row.name.trim() && !row.power.trim() && !row.inputCounts.trim(),
      valid: Boolean(key && nameCounts.get(key) === 1 && power !== null && power > 0 && allowedInputCounts.length > 0)
    });
  });
  return statuses;
}

function ensureMachineClassRows(targetState = state) {
  const meaningfulRows = targetState.machineClassRows.filter((row) => row.name.trim() || row.power.trim() || row.inputCounts.trim());
  const statuses = getMachineClassStatuses({ ...targetState, machineClassRows: meaningfulRows });
  const trimmed = [];
  for (const row of meaningfulRows) {
    trimmed.push(row);
    if (!statuses.get(row.id)?.valid) break;
  }
  targetState.machineClassRows = trimmed;
  const recalculated = getMachineClassStatuses(targetState);
  const allValid = targetState.machineClassRows.length > 0 && targetState.machineClassRows.every((row) => recalculated.get(row.id)?.valid);
  if (!targetState.machineClassRows.length || allValid) targetState.machineClassRows.push(emptyMachineClassRow());
}

function getBeltSpeedStatuses(targetState = state) {
  const meaningfulRows = (targetState.settings.beltSpeeds || []).filter((row) => row.speed.trim() || row.color.trim());
  const speedCounts = new Map();
  meaningfulRows.forEach((row) => {
    const speedKey = normalizeNumericString(row.speed, 6);
    if (speedKey) speedCounts.set(speedKey, (speedCounts.get(speedKey) || 0) + 1);
  });

  const statuses = new Map();
  (targetState.settings.beltSpeeds || []).forEach((row) => {
    const speedKey = normalizeNumericString(row.speed, 6);
    const speedNum = parseNumber(row.speed);
    statuses.set(row.id, {
      empty: !row.speed.trim() && !row.color.trim(),
      valid: Boolean(speedKey && speedNum !== null && speedNum > 0 && isValidColor(row.color) && speedCounts.get(speedKey) === 1)
    });
  });
  return statuses;
}

function ensureBeltSpeedRows(targetState = state) {
  const rows = (targetState.settings.beltSpeeds || []).filter((row) => row.speed.trim() || row.color.trim());
  const statuses = getBeltSpeedStatuses({ ...targetState, settings: { ...targetState.settings, beltSpeeds: rows } });
  const trimmed = [];
  for (const row of rows) {
    trimmed.push(row);
    if (!statuses.get(row.id)?.valid) break;
  }
  const current = trimmed.length ? trimmed : [];
  const recalculated = getBeltSpeedStatuses({ ...targetState, settings: { ...targetState.settings, beltSpeeds: current } });
  const allValid = current.length > 0 && current.every((row) => recalculated.get(row.id)?.valid);
  targetState.settings.beltSpeeds = allValid || !current.length ? [...current, emptyBeltSpeedRow()] : current;
}

function sanitizeBeltSelections(targetState = state) {
  const validBeltValues = new Set(getDefinedBeltSpeeds(targetState).map((entry) => String(entry.speed)));
  targetState.itemRows.forEach((row) => {
    row.belts.forEach((belt) => {
      if (belt.value !== "" && !validBeltValues.has(String(belt.value))) belt.value = "";
    });
  });
}

function ensureTrailingBelts(itemRow) {
  const nonEmpty = itemRow.belts.filter((belt) => belt.value !== "");
  itemRow.belts = nonEmpty.length ? [...nonEmpty, emptyBeltRow()] : [emptyBeltRow()];
}

function ensureStateStructure(targetState = state) {
  ensureItemRows(targetState);
  ensureMachineClassRows(targetState);
  ensureBeltSpeedRows(targetState);
  sanitizeBeltSelections(targetState);
  targetState.itemRows.forEach((row) => ensureTrailingBelts(row));
  targetState.recipes = targetState.recipes.map((recipe) => sanitizeRecipe(recipe));
}

function getDefinedItems(targetState = state) {
  const statuses = getItemRowStatuses(targetState);
  return targetState.itemRows
    .filter((row) => statuses.get(row.id)?.valid)
    .map((row) => ({ id: row.id, name: row.name.trim(), color: row.color.trim(), belts: row.belts }));
}

function getItemMap(targetState = state) {
  return new Map(getDefinedItems(targetState).map((item) => [item.id, item]));
}

function getDefinedMachineClasses(targetState = state) {
  const statuses = getMachineClassStatuses(targetState);
  return targetState.machineClassRows
    .filter((row) => statuses.get(row.id)?.valid)
    .map((row) => ({
      id: row.id,
      name: row.name.trim(),
      power: parseNumber(row.power) || 0,
      allowedInputCounts: parseExactInputCounts(row.inputCounts)
    }));
}

function getDefinedBeltSpeeds(targetState = state) {
  const statuses = getBeltSpeedStatuses(targetState);
  return (targetState.settings.beltSpeeds || [])
    .filter((row) => statuses.get(row.id)?.valid)
    .map((row) => ({
      id: row.id,
      speed: parseNumber(row.speed) || 0,
      speedText: normalizeNumericString(row.speed, 6),
      color: row.color.trim()
    }))
    .sort((a, b) => a.speed - b.speed);
}

function getMachineClassMap(targetState = state) {
  return new Map(getDefinedMachineClasses(targetState).map((row) => [row.id, row]));
}

function hasRealBeltInput(itemRow) {
  return itemRow.belts.some((belt) => belt.value !== "");
}

function sanitizeRecipe(recipe) {
  const next = {
    id: recipe.id || uid("recipe"),
    inputs: Array.isArray(recipe.inputs) ? recipe.inputs.map((row) => ({ id: row.id || uid("rin"), itemId: String(row.itemId || ""), qty: String(row.qty ?? "") })) : [emptyRecipeInputRow()],
    outputItemId: String(recipe.outputItemId || ""),
    outputQty: String(recipe.outputQty ?? ""),
    machineClassId: String(recipe.machineClassId || ""),
    itemsPerMinute: String(recipe.itemsPerMinute ?? "")
  };
  const filledInputs = next.inputs.filter((row) => row.itemId || row.qty !== "");
  next.inputs = filledInputs.length ? filledInputs : [];
  return next;
}

function createRecipeDraft(recipe = emptyRecipe()) {
  const next = sanitizeRecipe(recipe);
  syncDraftInputRowsToMachine(next);
  return next;
}

function isDraftInputRowValid(row) {
  const qty = parseNumber(row.qty);
  return Boolean(row.itemId && qty !== null && qty > 0);
}

function getDraftMaxInputRows(draft, targetState = state) {
  const machineClass = getMachineClassMap(targetState).get(draft.machineClassId);
  if (!machineClass?.allowedInputCounts?.length) return 1;
  return Math.max(...machineClass.allowedInputCounts);
}

function syncDraftInputRowsToMachine(draft, targetState = state) {
  const rowCount = getDraftMaxInputRows(draft, targetState);
  const existing = Array.isArray(draft.inputs) ? draft.inputs.slice(0, rowCount) : [];
  while (existing.length < rowCount) existing.push(emptyRecipeInputRow());
  draft.inputs = existing.map((row) => ({
    id: row.id || uid("rin"),
    itemId: String(row.itemId || ""),
    qty: String(row.qty ?? "")
  }));
}

function getDraftDuplicateInputIds(draft) {
  const counts = new Map();
  draft.inputs.forEach((row) => {
    if (!row.itemId) return;
    counts.set(row.itemId, (counts.get(row.itemId) || 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([itemId]) => itemId));
}

function getRecipeValidation(draft, targetState = state) {
  const itemMap = getItemMap(targetState);
  const machineMap = getMachineClassMap(targetState);
  const duplicateInputIds = getDraftDuplicateInputIds(draft);
  const filledInputCount = draft.inputs.filter((row) => row.itemId && parseNumber(row.qty) !== null && parseNumber(row.qty) > 0).length;
  const validInputs = draft.inputs
    .map((row) => ({ ...row, qtyNum: parseNumber(row.qty) }))
    .filter((row) => row.itemId && itemMap.has(row.itemId) && row.qtyNum !== null && row.qtyNum > 0);
  const outputQty = parseNumber(draft.outputQty);
  const itemsPerMinute = parseNumber(draft.itemsPerMinute);
  const machineClass = machineMap.get(draft.machineClassId);
  const inputCountAllowed = Boolean(machineClass && machineClass.allowedInputCounts.includes(filledInputCount));
  const incompleteFilledRows = draft.inputs.some((row) => {
    const hasItem = Boolean(row.itemId);
    const qty = parseNumber(row.qty);
    const hasQty = qty !== null && qty > 0;
    return hasItem !== hasQty;
  });
  const valid =
    validInputs.length > 0 &&
    duplicateInputIds.size === 0 &&
    !incompleteFilledRows &&
    draft.outputItemId &&
    itemMap.has(draft.outputItemId) &&
    outputQty !== null &&
    outputQty > 0 &&
    draft.machineClassId &&
    machineMap.has(draft.machineClassId) &&
    inputCountAllowed &&
    itemsPerMinute !== null &&
    itemsPerMinute > 0;
  return { valid, validInputs, duplicateInputIds, inputCountAllowed, filledInputCount, incompleteFilledRows };
}

function recipeSignature(recipe) {
  const inputs = recipe.inputs
    .map((row) => ({ itemId: row.itemId, qty: normalizeNumericString(row.qty, 6) }))
    .filter((row) => row.itemId && row.qty)
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  return JSON.stringify({
    inputs,
    outputItemId: recipe.outputItemId,
    outputQty: normalizeNumericString(recipe.outputQty, 6),
    machineClassId: recipe.machineClassId,
    itemsPerMinute: normalizeNumericString(recipe.itemsPerMinute, 6)
  });
}

function getDuplicateRecipeGroups(targetState = state) {
  const groups = new Map();
  targetState.recipes.forEach((recipe) => {
    const signature = recipeSignature(recipe);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(recipe.id);
  });
  return new Map([...groups.entries()].filter(([, ids]) => ids.length > 1));
}

function buildRecipeCatalog(targetState = state) {
  const duplicates = getDuplicateRecipeGroups(targetState);
  const duplicateIds = new Set([...duplicates.values()].flat());
  const firstIds = new Set([...duplicates.values()].map((ids) => ids[0]));
  const uniqueRecipes = targetState.recipes.filter((recipe) => !duplicateIds.has(recipe.id) || firstIds.has(recipe.id));
  return { duplicates, duplicateIds, uniqueRecipes };
}

function deriveItemRoles(targetState = state) {
  const items = getDefinedItems(targetState);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const externalInputIds = new Set();
  const externalRates = new Map();
  items.forEach((item) => {
    const total = item.belts.map((belt) => parseNumber(belt.value)).filter((value) => value !== null && value > 0).reduce((sum, value) => sum + value, 0);
    if (total > 0) {
      externalInputIds.add(item.id);
      externalRates.set(item.id, total);
    }
  });

  const producedIds = new Set();
  targetState.recipes.forEach((recipe) => {
    if (recipe.outputItemId && itemMap.has(recipe.outputItemId)) producedIds.add(recipe.outputItemId);
  });

  const invalidIds = new Set();
  items.forEach((item) => {
    const externallySupplied = externalInputIds.has(item.id);
    const produced = producedIds.has(item.id);
    const referencedAsInput = targetState.recipes.some((recipe) => recipe.inputs.some((row) => row.itemId === item.id));
    if (!externallySupplied && !produced && referencedAsInput) invalidIds.add(item.id);
  });

  return {
    items,
    itemMap,
    externalInputIds,
    externalRates,
    producedIds,
    invalidIds
  };
}

function chooseRecipeCandidate(candidates, requiredRate, settings, machineMap) {
  let best = null;
  debugLog(3, 1, "Choosing recipe candidate", { candidateCount: candidates.length, requiredRate });
  candidates.forEach((recipe) => {
    const machine = machineMap.get(recipe.machineClassId);
    const operatingPoint = computeRecipeOperatingPoint(recipe, machine, requiredRate, settings);
    if (!(operatingPoint.actualRate > 0)) return;
    const score = operatingPoint.powerUse * 1000 + operatingPoint.overflowRate * 10 + operatingPoint.machineCount;
    const candidate = { recipe, machine, ...operatingPoint, score };
    debugLog(3, 2, "Candidate evaluated", {
      recipeId: recipe.id,
      machineId: machine?.id || "",
      requestedRate: requiredRate,
      actualRate: operatingPoint.actualRate,
      overflowRate: operatingPoint.overflowRate,
      machineCount: operatingPoint.machineCount,
      powerUse: operatingPoint.powerUse,
      score
    });
    if (!best || candidate.score < best.score) best = candidate;
  });
  debugLog(3, 3, "Candidate selected", best ? {
    recipeId: best.recipe.id,
    machineId: best.machine?.id || "",
    score: best.score
  } : null);
  return best;
}

function getRecipeBaseOutputRate(recipe) {
  const speed = parseNumber(recipe.itemsPerMinute);
  return speed !== null && speed > 0 ? speed : 0;
}

function computeRecipeOperatingPoint(recipe, machine, requestedRate, settings) {
  const outputQty = parseNumber(recipe.outputQty);
  const baseRate = getRecipeBaseOutputRate(recipe);
  if (!machine || outputQty === null || outputQty <= 0 || baseRate === null || baseRate <= 0 || !(requestedRate > 0)) {
    debugLog(4, 1, "Recipe operating point invalid", {
      recipeId: recipe?.id || "",
      machineId: machine?.id || "",
      requestedRate,
      outputQty,
      baseRate
    });
    return {
      outputQty: outputQty || 0,
      baseRate: baseRate || 0,
      machineCount: 0,
      clock: 0,
      actualRate: 0,
      overflowRate: 0,
      powerUse: 0
    };
  }
  const safeMinClock = Math.max(CLOCK_SLIDER_MIN, Math.min(settings.minClock, 100));
  const fullMachines = Math.floor(requestedRate / baseRate);
  const remainder = Math.max(0, requestedRate - fullMachines * baseRate);
  const hasRemainderMachine = remainder > 1e-9;
  const rawClock = hasRemainderMachine ? (remainder / baseRate) * 100 : 0;
  const remainderClock = hasRemainderMachine ? Math.max(rawClock, safeMinClock) : 0;
  const machineCount = fullMachines + (hasRemainderMachine ? 1 : 0);
  const actualRate = fullMachines * baseRate + (hasRemainderMachine ? baseRate * (remainderClock / 100) : 0);
  const overflowRate = Math.max(0, actualRate - requestedRate);
  const fullMachinePower = fullMachines * computeClockedPower(machine.power, 100);
  const remainderPower = hasRemainderMachine ? computeClockedPower(machine.power, remainderClock) : 0;
  const powerUse = fullMachinePower + remainderPower;
  const clock = hasRemainderMachine ? remainderClock : 100;
  const instanceClocks = [
    ...Array.from({ length: fullMachines }, () => 100),
    ...(hasRemainderMachine ? [remainderClock] : [])
  ];
  const instanceRates = instanceClocks.map((instanceClock) => baseRate * (instanceClock / 100));
  const operatingPoint = {
    outputQty,
    baseRate,
    machineCount,
    clock,
    actualRate,
    overflowRate,
    powerUse,
    fullMachines,
    hasRemainderMachine,
    rawClock,
    remainderClock,
    instanceClocks,
    instanceRates
  };
  debugLog(4, 2, "Recipe operating point computed", {
    recipeId: recipe.id,
    machineId: machine.id,
    requestedRate,
    operatingPoint
  });
  return operatingPoint;
}

function mergeMaps(target, source) {
  source.forEach((value, key) => {
    target.set(key, (target.get(key) || 0) + value);
  });
}

function solveFactory(targetState = state) {
  const settings = getSettingsNumbers(targetState);
  const roleState = deriveItemRoles(targetState);
  const machineMap = getMachineClassMap(targetState);
  const machineList = getDefinedMachineClasses(targetState);
  const items = roleState.items;
  const errors = [];
  const warnings = [];
  debugLog(5, 1, "Solver started", {
    targetOutputItemId: targetState.settings.targetOutputItemId || "",
    targetOutputRate: targetState.settings.targetOutputRate,
    itemCount: items.length
  });

  const { duplicates, duplicateIds, uniqueRecipes } = buildRecipeCatalog(targetState);
  const recipeByOutput = new Map();
  uniqueRecipes.forEach((recipe) => {
    if (!recipe.outputItemId) return;
    if (!recipeByOutput.has(recipe.outputItemId)) recipeByOutput.set(recipe.outputItemId, []);
    recipeByOutput.get(recipe.outputItemId).push(recipe);
  });

  roleState.invalidIds.forEach((itemId) => {
    errors.push(`${roleState.itemMap.get(itemId)?.name || "Unknown"} is used as an input but has no external belt supply and no producing recipe.`);
  });

  if (!settings.targetOutputItemId) {
    return {
      settings,
      roleState,
      machineList,
      duplicateIds,
      duplicateGroups: duplicates,
      externalTotals: roleState.externalRates,
      machinePlans: [],
      overflowBelts: [],
      warnings,
      errors,
      reachable: false,
      targetNode: null
    };
  }

  const targetItem = roleState.itemMap.get(settings.targetOutputItemId);
  if (!targetItem) {
    errors.push("Target output item is not defined.");
    return {
      settings,
      roleState,
      machineList,
      duplicateIds,
      duplicateGroups: duplicates,
      externalTotals: roleState.externalRates,
      machinePlans: [],
      overflowBelts: [],
      warnings,
      errors,
      reachable: false,
      targetNode: null
    };
  }

  const targetRate = settings.targetOutputRate;
  if (!(targetRate > 0)) {
    errors.push("Target output rate must be greater than zero.");
    return {
      settings,
      roleState,
      machineList,
      duplicateIds,
      duplicateGroups: duplicates,
      externalTotals: roleState.externalRates,
      machinePlans: [],
      overflowBelts: [],
      warnings,
      errors,
      reachable: false,
      targetNode: null
    };
  }

  const planMap = new Map();
  const externalDemand = new Map();
  const overflowBelts = [];
  const remainingExternal = new Map(roleState.externalRates);
  let nextOverflowBelt = 1;
  const maxBeltSpeed = settings.beltSpeeds.length ? Math.max(...settings.beltSpeeds.map((entry) => entry.speed)) : 0;
  const beltCapacityWarnings = new Set();

  function solveItem(itemId, requiredRate, trail = []) {
    debugLog(5, 2, "solveItem start", { itemId, requiredRate, trail });
    if (trail.includes(itemId)) return { ok: false, error: `Cycle detected involving ${roleState.itemMap.get(itemId)?.name || "Unknown"}.` };
    const item = roleState.itemMap.get(itemId);
    if (!item) return { ok: false, error: "Unknown item in solver." };

    if (roleState.externalInputIds.has(itemId)) {
      const beltLimitedRate = maxBeltSpeed > 0 ? Math.min(requiredRate, maxBeltSpeed) : requiredRate;
      if (maxBeltSpeed > 0 && requiredRate > maxBeltSpeed + 1e-9) {
        const warningKey = `external:${itemId}`;
        if (!beltCapacityWarnings.has(warningKey)) {
          warnings.push(`Belt capacity warning: ${item.name} input requires ${fmt(requiredRate)} item/min, exceeding the fastest belt speed ${fmt(maxBeltSpeed)} item/min. Using actual input ${fmt(beltLimitedRate)} item/min for recalculation.`);
          beltCapacityWarnings.add(warningKey);
        }
      }
      externalDemand.set(itemId, (externalDemand.get(itemId) || 0) + beltLimitedRate);
      const available = remainingExternal.get(itemId) || 0;
      const deliveredRate = Math.min(beltLimitedRate, available);
      remainingExternal.set(itemId, Math.max(0, available - deliveredRate));
      const node = { type: "external", itemId, label: item.name, rate: deliveredRate, requestedRate: beltLimitedRate, children: [] };
      debugLog(5, 3, "External input resolved", {
        itemId,
        itemName: item.name,
        requiredRate,
        beltLimitedRate,
        available,
        deliveredRate
      });
      return { ok: true, node, power: 0 };
    }

    const candidates = recipeByOutput.get(itemId) || [];
    const chosen = chooseRecipeCandidate(candidates, requiredRate, settings, machineMap);
    if (!chosen) return { ok: false, error: `${item.name} is not externally supplied and no valid recipe can produce it.` };
    debugLog(5, 4, "Recipe chosen for item", {
      itemId,
      itemName: item.name,
      requiredRate,
      recipeId: chosen.recipe.id,
      machineId: chosen.machine.id
    });

    const inputNodes = [];
    const inputLimitedRates = [];
    for (const row of chosen.recipe.inputs) {
      const qty = parseNumber(row.qty);
      if (!row.itemId || qty === null || qty <= 0) continue;
      const neededRate = requiredRate * qty / chosen.outputQty;
      const actualInputRate = maxBeltSpeed > 0 ? Math.min(neededRate, maxBeltSpeed) : neededRate;
      if (maxBeltSpeed > 0 && neededRate > maxBeltSpeed + 1e-9) {
        const inputItemName = roleState.itemMap.get(row.itemId)?.name || "Unknown";
        const warningKey = `input:${itemId}:${row.itemId}`;
        if (!beltCapacityWarnings.has(warningKey)) {
          warnings.push(`Belt capacity warning: ${inputItemName} input for ${item.name} requires ${fmt(neededRate)} item/min, exceeding the fastest belt speed ${fmt(maxBeltSpeed)} item/min. Using actual input ${fmt(actualInputRate)} item/min for recalculation.`);
          beltCapacityWarnings.add(warningKey);
        }
      }
      const inputResult = solveItem(row.itemId, actualInputRate, [...trail, itemId]);
      if (!inputResult.ok) return inputResult;
      inputNodes.push(inputResult.node);
      const deliveredInputRate = inputResult.node.actualRate || inputResult.node.rate || 0;
      inputLimitedRates.push(deliveredInputRate * chosen.outputQty / qty);
      debugLog(5, 5, "Recipe input processed", {
        parentItemId: itemId,
        inputItemId: row.itemId,
        qtyPerCraft: qty,
        neededRate,
        actualInputRate,
        deliveredInputRate,
        resultingOutputLimit: deliveredInputRate * chosen.outputQty / qty
      });
    }

    const maxSupportedRate = inputLimitedRates.length ? Math.min(...inputLimitedRates) : requiredRate;
    const desiredRate = Math.max(0, Math.min(requiredRate, maxSupportedRate));
    const operatingPoint = computeRecipeOperatingPoint(chosen.recipe, chosen.machine, desiredRate, settings);
    debugLog(5, 6, "Item limited by inputs", {
      itemId,
      requiredRate,
      inputLimitedRates,
      maxSupportedRate,
      desiredRate,
      actualRate: operatingPoint.actualRate
    });

    if (operatingPoint.overflowRate > 0) {
      const beltId = nextOverflowBelt++;
      overflowBelts.push({ id: beltId, itemId, itemName: item.name, rate: operatingPoint.overflowRate, recipeId: chosen.recipe.id });
      warnings.push(`The recipe ${item.name} produces more output per power than a tighter-fit alternative. Excess will be generated. Overflow belt assigned: Belt ${beltId}`);
    }

    if (!planMap.has(chosen.recipe.id)) {
      planMap.set(chosen.recipe.id, {
        recipeId: chosen.recipe.id,
        outputItemId: itemId,
        outputItemName: item.name,
        machineClassId: chosen.machine.id,
        machineName: chosen.machine.name,
        machinePower100: chosen.machine.power,
        requiredRate: 0,
        actualRate: 0,
        machineCount: 0,
        clock: 0,
        powerUse: 0,
        recipe: chosen.recipe
      });
    }

    const plan = planMap.get(chosen.recipe.id);
    plan.requiredRate += requiredRate;
    plan.actualRate += operatingPoint.actualRate;
    plan.machineCount += operatingPoint.machineCount;
    plan.powerUse += operatingPoint.powerUse;
    plan.clock = Math.max(plan.clock, operatingPoint.clock);
    debugLog(5, 7, "Plan updated", {
      recipeId: chosen.recipe.id,
      requiredRate: plan.requiredRate,
      actualRate: plan.actualRate,
      machineCount: plan.machineCount,
      powerUse: plan.powerUse,
      clock: plan.clock
    });

    return {
      ok: true,
      power: operatingPoint.powerUse + inputNodes.reduce((sum, node) => sum + (node.powerUse || 0), 0),
      node: {
        type: "recipe",
        recipeId: chosen.recipe.id,
        outputItemId: itemId,
        label: item.name,
        machineName: chosen.machine.name,
        requiredRate,
        actualRate: operatingPoint.actualRate,
        overflowRate: operatingPoint.overflowRate,
        machineCount: operatingPoint.machineCount,
        instanceClocks: operatingPoint.instanceClocks,
        instanceRates: operatingPoint.instanceRates,
        children: inputNodes,
        powerUse: operatingPoint.powerUse
      }
    };
  }

  const targetResult = solveItem(settings.targetOutputItemId, targetRate, []);
  if (!targetResult.ok) errors.push(targetResult.error);
  const producedTargetRate = targetResult.ok
    ? (targetResult.node.actualRate || targetResult.node.rate || 0)
    : 0;

  if (targetResult.ok && producedTargetRate + 1e-9 < targetRate) {
    warnings.push(`Target output is under-satisfied. Required ${fmt(targetRate)} item/min, produced ${fmt(producedTargetRate)} item/min.`);
  }

  externalDemand.forEach((demand, itemId) => {
    const available = roleState.externalRates.get(itemId) || 0;
    if (demand > available) {
      warnings.push(`${roleState.itemMap.get(itemId)?.name || "Unknown"} requires ${fmt(demand)} item/min, but only ${fmt(available)} item/min is externally available.`);
    }
  });

  const machinePlans = [...planMap.values()];
  const totalPower = machinePlans.reduce((sum, plan) => sum + plan.powerUse, 0);
  if (totalPower > settings.maxPower) warnings.push(`Power limit exceeded by ${fmt(totalPower - settings.maxPower)} MW.`);
  if (duplicates.size) warnings.push("Duplicate recipes detected. Only the first instance of each duplicate set is used by the solver.");
  if (targetResult.ok && maxBeltSpeed > 0) {
    const warned = new Set();
    collectNodeFlows(targetResult.node).forEach((flow) => {
      if (flow.rate > maxBeltSpeed && !warned.has(flow.label)) {
        warnings.push(`Belt capacity warning: ${flow.label} requires ${fmt(flow.rate)} item/min, exceeding the fastest belt speed ${fmt(maxBeltSpeed)} item/min. Using the fastest belt and recomputing flow.`);
        warned.add(flow.label);
      }
    });
  }

  const result = {
    settings,
    roleState,
    machineList,
    duplicateIds,
    duplicateGroups: duplicates,
    externalTotals: roleState.externalRates,
    externalDemand,
    machinePlans,
    totalPower,
    overflowBelts,
    warnings: [...new Set(warnings)],
    errors,
    reachable: errors.length === 0 && Boolean(targetResult.ok) && producedTargetRate + 1e-9 >= targetRate,
    producedTargetRate,
    targetNode: targetResult.ok ? targetResult.node : null
  };
  debugLog(5, 8, "Solver finished", result);
  return result;
}

function nodeTreeDepth(node) {
  if (!node) return 0;
  if (!node.children?.length) return 1;
  return 1 + Math.max(...node.children.map(nodeTreeDepth));
}

function nodeLeafCount(node) {
  if (!node?.children?.length) return 1;
  return node.children.reduce((sum, child) => sum + nodeLeafCount(child), 0);
}

function collectNodeFlows(node, collector = []) {
  if (!node) return collector;
  const rate = node.actualRate || node.rate || 0;
  if (rate > 0) collector.push({ itemId: node.outputItemId || node.itemId || "", label: node.label || "Item", rate });
  (node.children || []).forEach((child) => collectNodeFlows(child, collector));
  return collector;
}

function averageHexColors(colors) {
  const valid = colors.filter((color) => isValidColor(color));
  if (!valid.length) return "#8c836a";
  const totals = valid.reduce((sum, color) => {
    const rgb = hexToRgb(color);
    sum.r += rgb.r;
    sum.g += rgb.g;
    sum.b += rgb.b;
    return sum;
  }, { r: 0, g: 0, b: 0 });
  return rgbToHex(totals.r / valid.length, totals.g / valid.length, totals.b / valid.length);
}

function getNodeItemColor(node, itemMap) {
  if (!node) return "#6b6250";
  const itemId = node.outputItemId || node.itemId;
  return itemMap.get(itemId)?.color || "#6b6250";
}

function chooseBeltSpeedForRate(rate, beltSpeeds) {
  if (!beltSpeeds.length) return null;
  const target = Math.max(0, rate || 0);
  const sorted = [...beltSpeeds].sort((a, b) => a.speed - b.speed);
  return sorted.find((entry) => entry.speed >= target) || sorted[sorted.length - 1];
}

function beltStrokeWidth(rate, beltSpeed) {
  if (!beltSpeed || !beltSpeed.speed) return APP_CONFIG.belt.baseStroke + APP_CONFIG.belt.extraStroke * APP_CONFIG.belt.minimumRatio;
  const ratio = Math.max(APP_CONFIG.belt.minimumRatio, Math.min(1, rate / beltSpeed.speed));
  return APP_CONFIG.belt.baseStroke + ratio * APP_CONFIG.belt.extraStroke;
}

function computeFactoryLayout(node, level = 0, leafCursor = { value: 0 }, layouts = []) {
  if (!node) return layouts;
  const children = node.children || [];
  let x;
  if (!children.length) {
    x = 140 + leafCursor.value * 220;
    leafCursor.value += 1;
  } else {
    const childLayouts = [];
    children.forEach((child) => computeFactoryLayout(child, level + 1, leafCursor, childLayouts));
    x = childLayouts.reduce((sum, entry) => sum + entry.x, 0) / childLayouts.length;
    childLayouts.forEach((entry) => layouts.push(entry));
  }
  layouts.push({ node, level, x });
  debugLog(6, 1, "Layout node placed", {
    label: node.label || node.itemId || "",
    type: node.type,
    level,
    x
  });
  return layouts;
}

function getLayoutNodeHalfWidth(node) {
  if (!node || node.type === "external") return 40;
  const machineCount = Math.max(1, node.machineCount || 1);
  const inputCount = Math.max(1, (node.children || []).length);
  const machineWidth = computeMachineWidth(inputCount);
  const totalWidth = machineWidth + (machineCount - 1) * APP_CONFIG.geometry.machineInstanceSpacing;
  return totalWidth / 2;
}

function stabilizeFactoryLayout(layouts) {
  const byNode = new Map(layouts.map((entry) => [entry.node, { ...entry }]));
  const entries = layouts.map((entry) => byNode.get(entry.node));
  const minimumGap = ROUTING_NODE_DIAMETER;

  for (let iteration = 0; iteration < 24; iteration += 1) {
    let changed = false;
    debugLog(6, 2, "Layout stabilization iteration", { iteration });

    entries.forEach((entry) => {
      const children = entry.node?.children || [];
      if (!children.length) return;
      const childEntries = children.map((child) => byNode.get(child)).filter(Boolean);
      if (!childEntries.length) return;
      const averageX = childEntries.reduce((sum, childEntry) => sum + childEntry.x, 0) / childEntries.length;
      if (Math.abs(entry.x - averageX) > 0.01) {
        debugLog(6, 3, "Parent recentered", {
          label: entry.node.label || entry.node.itemId || "",
          fromX: entry.x,
          toX: averageX
        });
        entry.x = averageX;
        changed = true;
      }
    });

    const levelGroups = new Map();
    entries.forEach((entry) => {
      if (!levelGroups.has(entry.level)) levelGroups.set(entry.level, []);
      levelGroups.get(entry.level).push(entry);
    });

    levelGroups.forEach((group) => {
      group.sort((a, b) => a.x - b.x);
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1];
        const current = group[index];
        const previousRight = previous.x + getLayoutNodeHalfWidth(previous.node);
        const currentLeft = current.x - getLayoutNodeHalfWidth(current.node);
        const requiredLeft = previousRight + minimumGap;
        if (currentLeft < requiredLeft - 0.01) {
          debugLog(6, 4, "Minimum machine distance enforced", {
            previous: previous.node.label || previous.node.itemId || "",
            current: current.node.label || current.node.itemId || "",
            previousRight,
            currentLeft,
            requiredLeft,
            shift: requiredLeft - currentLeft
          });
          current.x += requiredLeft - currentLeft;
          changed = true;
        }
      }
    });

    if (!changed) break;
  }

  debugLog(6, 5, "Layout stabilization complete", entries.map((entry) => ({
    label: entry.node.label || entry.node.itemId || "",
    level: entry.level,
    x: entry.x
  })));
  return entries;
}

function makeOrthogonalSegments(points) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a.x === b.x && a.y === b.y) continue;
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, overpass: false });
  }
  return segments;
}

function applyEndpointProtection(segments, startProtect = 0, endProtect = 0) {
  if (!segments.length) return segments;
  if (startProtect > 0) segments[0].noArrowStart = Math.max(segments[0].noArrowStart || 0, startProtect);
  if (endProtect > 0) segments[segments.length - 1].noArrowEnd = Math.max(segments[segments.length - 1].noArrowEnd || 0, endProtect);
  return segments;
}

function segmentIsHorizontal(segment) {
  return segment.y1 === segment.y2;
}

function segmentIsVertical(segment) {
  return segment.x1 === segment.x2;
}

function segmentLength(segment) {
  return Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1);
}

function nonEndpointCrossing(horizontal, vertical) {
  const hx1 = Math.min(horizontal.x1, horizontal.x2);
  const hx2 = Math.max(horizontal.x1, horizontal.x2);
  const vy1 = Math.min(vertical.y1, vertical.y2);
  const vy2 = Math.max(vertical.y1, vertical.y2);
  const x = vertical.x1;
  const y = horizontal.y1;
  const horizontalHit = x > hx1 && x < hx2;
  const verticalHit = y > vy1 && y < vy2;
  return horizontalHit && verticalHit;
}

function rangesOverlap(a1, a2, b1, b2) {
  const minA = Math.min(a1, a2);
  const maxA = Math.max(a1, a2);
  const minB = Math.min(b1, b2);
  const maxB = Math.max(b1, b2);
  return Math.min(maxA, maxB) - Math.max(minA, minB) > 1e-9;
}

function segmentsParallelOverlap(a, b) {
  const aHorizontal = segmentIsHorizontal(a);
  const bHorizontal = segmentIsHorizontal(b);
  if (aHorizontal !== bHorizontal) return false;
  if (aHorizontal) {
    return a.y1 === b.y1 && rangesOverlap(a.x1, a.x2, b.x1, b.x2);
  }
  return a.x1 === b.x1 && rangesOverlap(a.y1, a.y2, b.y1, b.y2);
}

function shiftSegmentPerpendicular(belt, segmentIndex, delta) {
  const segment = belt.segments[segmentIndex];
  if (!segment || delta === 0) return;
  const original = { ...segment };
  const horizontal = segmentIsHorizontal(segment);

  if (horizontal) {
    segment.y1 += delta;
    segment.y2 += delta;
    const prev = belt.segments[segmentIndex - 1];
    const next = belt.segments[segmentIndex + 1];
    if (prev) {
      if (prev.x2 === original.x1 && prev.y2 === original.y1) prev.y2 += delta;
      if (prev.x1 === original.x1 && prev.y1 === original.y1) prev.y1 += delta;
    }
    if (next) {
      if (next.x1 === original.x2 && next.y1 === original.y2) next.y1 += delta;
      if (next.x2 === original.x2 && next.y2 === original.y2) next.y2 += delta;
    }
  } else {
    segment.x1 += delta;
    segment.x2 += delta;
    const prev = belt.segments[segmentIndex - 1];
    const next = belt.segments[segmentIndex + 1];
    if (prev) {
      if (prev.x2 === original.x1 && prev.y2 === original.y1) prev.x2 += delta;
      if (prev.x1 === original.x1 && prev.y1 === original.y1) prev.x1 += delta;
    }
    if (next) {
      if (next.x1 === original.x2 && next.y1 === original.y2) next.x1 += delta;
      if (next.x2 === original.x2 && next.y2 === original.y2) next.x2 += delta;
    }
  }
}

function resolveParallelOverlaps(belts) {
  const laneStep = APP_CONFIG.belt.parallelOverlapStep;
  for (let beltIndex = 0; beltIndex < belts.length; beltIndex += 1) {
    const belt = belts[beltIndex];
    for (let segmentIndex = 0; segmentIndex < belt.segments.length; segmentIndex += 1) {
      let guard = 0;
      while (guard < 20) {
        guard += 1;
        const segment = belt.segments[segmentIndex];
        let hasOverlap = false;

        for (let prevBeltIndex = 0; prevBeltIndex <= beltIndex; prevBeltIndex += 1) {
          const prevBelt = belts[prevBeltIndex];
          const maxSegmentIndex = prevBeltIndex === beltIndex ? segmentIndex - 1 : prevBelt.segments.length - 1;
          for (let prevSegmentIndex = 0; prevSegmentIndex <= maxSegmentIndex; prevSegmentIndex += 1) {
            if (segmentsParallelOverlap(segment, prevBelt.segments[prevSegmentIndex])) {
              hasOverlap = true;
              break;
            }
          }
          if (hasOverlap) break;
        }

        if (!hasOverlap) break;
        shiftSegmentPerpendicular(belt, segmentIndex, laneStep);
      }
    }
  }
}

function markOverpasses(belts) {
  const horizontals = [];
  const verticals = [];
  belts.forEach((belt, beltIndex) => {
    belt.segments.forEach((segment, segmentIndex) => {
      const descriptor = { beltIndex, segmentIndex, segment };
      if (segmentIsHorizontal(segment)) horizontals.push(descriptor);
      else verticals.push(descriptor);
    });
  });

  horizontals.forEach((horizontal) => {
    verticals.forEach((vertical) => {
      if (horizontal.beltIndex === vertical.beltIndex) return;
      if (nonEndpointCrossing(horizontal.segment, vertical.segment)) {
        belts[horizontal.beltIndex].segments[horizontal.segmentIndex].overpass = true;
      }
    });
  });
}

function segmentDirection(segment) {
  if (segment.x2 > segment.x1) return "right";
  if (segment.x2 < segment.x1) return "left";
  if (segment.y2 > segment.y1) return "down";
  return "up";
}

function openArrowPath(x, y, direction, size = 7) {
  if (direction === "right") return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size}`;
  if (direction === "left") return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size}`;
  if (direction === "down") return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size}`;
  return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size}`;
}

function renderArrowHeadsForSegment(segment, speedColor, overpass) {
  const length = segmentLength(segment);
  const startPadding = Math.max(0, segment.noArrowStart || 0);
  const endPadding = Math.max(0, segment.noArrowEnd || 0);
  const usableLength = length - startPadding - endPadding;
  if (usableLength < 8) return "";
  const direction = segmentDirection(segment);
  const contrast = contrastColor(speedColor);
  const spacing = APP_CONFIG.belt.arrowSpacing;
  const count = Math.max(1, Math.floor(usableLength / spacing));
  const arrows = [];
  for (let index = 1; index <= count; index += 1) {
    const preferredOffset = count === 1
      ? startPadding + usableLength / 2
      : startPadding + (usableLength * index) / (count + 1);
    const offset = Math.max(startPadding + APP_CONFIG.belt.arrowMinOffset, Math.min(length - endPadding - APP_CONFIG.belt.arrowMinOffset, preferredOffset));
    const x = segment.x1 === segment.x2
      ? segment.x1
      : (segment.x2 > segment.x1 ? segment.x1 + offset : segment.x1 - offset);
    const y = segment.y1 === segment.y2
      ? segment.y1
      : (segment.y2 > segment.y1 ? segment.y1 + offset : segment.y1 - offset);
    const path = openArrowPath(x, y, direction, APP_CONFIG.belt.arrowSize);
    const dash = overpass ? ` stroke-dasharray="4 3"` : "";
    arrows.push(`<path d="${path}" fill="none" stroke="${contrast}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"${dash}></path>`);
    arrows.push(`<path d="${path}" fill="none" stroke="${speedColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"${dash}></path>`);
  }
  return arrows.join("");
}

function renderFactoryBelt(belt) {
  const itemColor = belt.itemColor || "#6b6250";
  const speedColor = belt.speedColor || "#ffffff";
  const tooltipAttr = belt.tooltip ? ` data-factory-tooltip="${escapeHtml(belt.tooltip)}"` : "";
  return `<g class="factory-belt"${tooltipAttr}>${belt.segments.map((segment) => {
    const dash = segment.overpass ? ` stroke-dasharray="12 10"` : "";
    const strokeWidth = segment.strokeWidth || 6;
    return `
      <g>
        <line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="${itemColor}" stroke-width="${strokeWidth}" stroke-linecap="round"${dash}></line>
        ${renderArrowHeadsForSegment(segment, speedColor, segment.overpass)}
      </g>
    `;
  }).join("")}</g>`;
}

function renderFactoryNodeLabel(x, y, title, subtitle) {
  return `
    <text x="${x}" y="${y}" text-anchor="middle" class="factory-label">${escapeHtml(title)}</text>
    <text x="${x}" y="${y + 16}" text-anchor="middle" class="factory-sub">${escapeHtml(subtitle)}</text>
  `;
}

function renderRoutingNode(x, y, color, tooltip = "") {
  const tooltipAttr = tooltip ? ` data-factory-tooltip="${escapeHtml(tooltip)}"` : "";
  return `<circle cx="${x}" cy="${y}" r="${ROUTING_NODE_RADIUS}" fill="${color}" stroke="rgba(60,48,31,0.8)" stroke-width="2"${tooltipAttr}></circle>`;
}

function getSplitterPorts(x, y, branchCount) {
  if (branchCount === 2) {
    return {
      input: { x, y },
      inputKind: "bottom",
      outputs: [
        { point: { x, y }, kind: "side" },
        { point: { x, y }, kind: "side" }
      ]
    };
  }
  return {
    input: { x, y },
    inputKind: "bottom",
    outputs: [
      { point: { x, y }, kind: "side" },
      { point: { x, y }, kind: "side" },
      { point: { x, y }, kind: "top" }
    ]
  };
}

function getMergerPorts(x, y, branchCount) {
  if (branchCount === 2) {
    return {
      inputs: [
        { point: { x, y }, kind: "side" },
        { point: { x, y }, kind: "side" }
      ],
      output: { point: { x, y }, kind: "top" }
    };
  }
  return {
    inputs: [
      { point: { x, y }, kind: "side" },
      { point: { x, y }, kind: "side" },
      { point: { x, y }, kind: "bottom" }
    ],
    output: { point: { x, y }, kind: "top" }
  };
}

function computeMachineWidth(inputCount) {
  const safeCount = Math.max(1, inputCount || 1);
  const edgePadding = BELT_MIN_WIDTH;
  const minSegmentWidth = BELT_LANE_SPACING;
  return Math.max(MACHINE_BASE_WIDTH, edgePadding * 2 + safeCount * minSegmentWidth);
}

function getMachineInputSlotXs(centerX, machineWidth, inputCount) {
  if (inputCount <= 1) return [centerX];
  const edgePadding = BELT_MIN_WIDTH;
  const usableWidth = machineWidth - edgePadding * 2;
  const segmentWidth = usableWidth / inputCount;
  const left = centerX - machineWidth / 2 + edgePadding;
  return Array.from({ length: inputCount }, (_, index) => left + segmentWidth * (index + 0.5));
}

function findExactFactorChain(target, allowedSizes) {
  const sizes = [...new Set((allowedSizes || []).filter((size) => Number.isInteger(size) && size > 1))].sort((a, b) => a - b);
  if (target <= 1) return [];
  if (!sizes.length) return null;

  const queue = [{ product: 1, factors: [] }];
  const visited = new Set([1]);
  while (queue.length) {
    const current = queue.shift();
    for (const size of sizes) {
      const nextProduct = current.product * size;
      if (nextProduct > target || target % nextProduct !== 0) continue;
      const nextFactors = [...current.factors, size];
      if (nextProduct === target) return nextFactors;
      if (!visited.has(nextProduct)) {
        visited.add(nextProduct);
        queue.push({ product: nextProduct, factors: nextFactors });
      }
    }
  }
  return null;
}

function partitionTargets(targets, groups) {
  const size = targets.length / groups;
  const partitions = [];
  for (let index = 0; index < groups; index += 1) {
    partitions.push(targets.slice(index * size, (index + 1) * size));
  }
  return partitions;
}

function routeHV(start, end) {
  if (start.x === end.x || start.y === end.y) return [start, end];
  return [start, { x: end.x, y: start.y }, end];
}

function compressPoints(points) {
  const compressed = [];
  points.forEach((point) => {
    const last = compressed[compressed.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    compressed.push(point);
  });
  return compressed;
}

function routeIntoPort(start, port, kind) {
  if (kind === "side") {
    return compressPoints([start, { x: start.x, y: port.y }, port]);
  }
  return compressPoints([start, { x: port.x, y: start.y }, port]);
}

function routeOutOfPort(port, end, kind) {
  if (kind === "side") {
    return compressPoints([port, { x: end.x, y: port.y }, end]);
  }
  return compressPoints([port, { x: port.x, y: end.y }, end]);
}

function extendBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function connectBeltPath(collection, itemColor, speedColor, rate, points) {
  collection.push({
    itemColor,
    speedColor,
    segments: makeOrthogonalSegments(points).map((segment) => ({ ...segment, strokeWidth: beltStrokeWidth(rate, { speed: rate || 1, color: speedColor }) }))
  });
}

function renderSolverBoard(solution) {
  debugLog(7, 1, "Board render start", {
    reachable: solution.reachable,
    warningCount: solution.warnings.length,
    errorCount: solution.errors.length
  });
  if (!solution.targetNode) {
    const hasTarget = Boolean(solution.settings.targetOutputItemId);
    const hasRecipes = state.recipes.length > 0;
    let title = "Select a target output item";
    let subtitle = "The production chain will be generated automatically from recipes and external inputs.";

    if (hasTarget && solution.errors.length) {
      title = "No layout";
      subtitle = solution.errors[0];
    } else if (hasTarget && !solution.errors.length) {
      title = "Resolving production chain";
      subtitle = "The solver is checking recipe reachability and available external inputs.";
    } else if (!hasRecipes) {
      title = "Add a valid recipe";
      subtitle = "Once a recipe exists and a target is selected, the layout is generated automatically.";
    }

    return `
      <svg viewBox="0 0 1200 480" role="img" aria-label="Solver board">
        <text x="600" y="200" text-anchor="middle" class="board-placeholder">${escapeHtml(title)}</text>
        <text x="600" y="230" text-anchor="middle" class="board-placeholder-sub">${escapeHtml(subtitle)}</text>
      </svg>
    `;
  }

  const itemMap = solution.roleState.itemMap;
  const beltSpeeds = solution.settings.beltSpeeds;
  const layouts = stabilizeFactoryLayout(computeFactoryLayout(solution.targetNode));
  const maxLevel = Math.max(...layouts.map((entry) => entry.level));
  const width = Math.max(1200, 280 + Math.max(...layouts.map((entry) => entry.x)));
  const height = Math.max(560, 220 + (maxLevel + 1) * 230);
  const machineHeight = MACHINE_HEIGHT;
  const topMargin = 170;
  const levelGap = 220;
  const machineNodeGap = ROUTING_NODE_DIAMETER;
  const positions = new Map();
  layouts.forEach((entry) => {
    positions.set(entry.node, {
      x: entry.x,
      y: topMargin + entry.level * levelGap
    });
  });

  const belts = [];
  const outputBelts = [];
  const renderedNodes = [];
  const routingNodeMeta = [];
  const planByRecipeId = new Map(solution.machinePlans.map((plan) => [plan.recipeId, plan]));
  const layoutBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let layoutInvalidReason = "";

  function addBelt(collection, itemColor, rate, points, itemName = "", startProtect = 0, endProtect = 0, startConnection = "", endConnection = "") {
    if (!points || points.length < 2) {
      layoutInvalidReason = "INVALID: every belt must have a continuous path with start_connection and end_connection.";
      return;
    }
    if (!startConnection || !endConnection) {
      layoutInvalidReason = "INVALID: every belt must have start_connection and end_connection.";
      return;
    }
    const beltSpeed = chooseBeltSpeedForRate(rate, beltSpeeds);
    collection.push({
      itemColor,
      speedColor: beltSpeed?.color || "#ffffff",
      tooltip: `${itemName || "Item"}\n${fmt(rate)} item/min`,
      startConnection,
      endConnection,
      segments: applyEndpointProtection(
        makeOrthogonalSegments(points).map((segment) => ({ ...segment, strokeWidth: beltStrokeWidth(rate, beltSpeed) })),
        startProtect,
        endProtect
      )
    });
    debugLog(7, 2, "Belt rendered", {
      itemName,
      rate,
      startConnection,
      endConnection,
      points,
      startProtect,
      endProtect
    });
    points.forEach((point) => extendBounds(layoutBounds, point.x, point.y));
  }

  function addRoutingNode(x, y, color, tooltip, role = "", branchCount = 0) {
    renderedNodes.push(`<g class="factory-routing-node">${renderRoutingNode(x, y, color, tooltip)}</g>`);
    routingNodeMeta.push({ x, y, role, branchCount });
    debugLog(7, 3, "Routing node rendered", { x, y, color, role, branchCount, tooltip });
    extendBounds(layoutBounds, x - ROUTING_NODE_RADIUS - 2, y - ROUTING_NODE_RADIUS - 2);
    extendBounds(layoutBounds, x + ROUTING_NODE_RADIUS + 2, y + ROUTING_NODE_RADIUS + 2);
  }

  function routeMergerOutputTopOnly(startPoint, targetPoint) {
    if (!targetPoint || targetPoint.y >= startPoint.y) {
      layoutInvalidReason = "INVALID: merger.output_direction must be TOP ONLY.";
      return null;
    }
    if (startPoint.x === targetPoint.x) return [startPoint, targetPoint];
    return compressPoints([startPoint, { x: startPoint.x, y: targetPoint.y }, targetPoint]);
  }

  function connectSplitterTree(startPoint, targetPoints, itemColor, totalRate, levelBaseY, itemName) {
    if (targetPoints.length === 1) {
      addBelt(belts, itemColor, totalRate, routeHV(startPoint, targetPoints[0]), itemName, 0, 0, `${itemName}:source`, `${itemName}:target`);
      return;
    }

    const factors = findExactFactorChain(targetPoints.length, solution.settings.splitterSizes);
    if (!factors?.length) {
      const nodeX = targetPoints.reduce((sum, point) => sum + point.x, 0) / targetPoints.length;
      const nodeY = levelBaseY;
      const ports = getSplitterPorts(nodeX, nodeY, targetPoints.length);
      addBelt(belts, itemColor, totalRate, routeIntoPort(startPoint, ports.input, ports.inputKind), itemName, 0, NODE_ARROW_PROTECTION, `${itemName}:source`, `${itemName}:splitter-input`);
      const branchRate = totalRate / targetPoints.length;
      addRoutingNode(nodeX, nodeY, itemColor, `Splitter\n${itemName || "Item"} input: ${fmt(totalRate)} item/min\n${itemName || "Item"} outputs: ${targetPoints.map(() => `${fmt(branchRate)} item/min`).join(", ")}`, "splitter", targetPoints.length);
      targetPoints.forEach((point, index) => addBelt(belts, itemColor, branchRate, routeOutOfPort(ports.outputs[index].point, point, ports.outputs[index].kind), itemName, NODE_ARROW_PROTECTION, 0, `${itemName}:splitter-output-${index + 1}`, `${itemName}:target-${index + 1}`));
      return;
    }

    function recurse(sourcePoint, points, factorIndex, y) {
      if (points.length === 1) {
        addBelt(belts, itemColor, totalRate / targetPoints.length, routeHV(sourcePoint, points[0]), itemName, 0, 0, `${itemName}:splitter-branch-source`, `${itemName}:splitter-branch-target`);
        return;
      }
      const factor = factors[factorIndex];
      const groups = partitionTargets(points, factor);
      const nodeX = groups.reduce((sum, group) => sum + group.reduce((inner, point) => inner + point.x, 0) / group.length, 0) / groups.length;
      const nodeY = y;
      const inboundRate = totalRate * (points.length / targetPoints.length);
      const ports = getSplitterPorts(nodeX, nodeY, factor);
      addBelt(belts, itemColor, inboundRate, routeIntoPort(sourcePoint, ports.input, ports.inputKind), itemName, 0, NODE_ARROW_PROTECTION, `${itemName}:source`, `${itemName}:splitter-input`);
      const nextY = y + 34;
      const childRate = inboundRate / factor;
      addRoutingNode(nodeX, nodeY, itemColor, `Splitter\n${itemName || "Item"} input: ${fmt(inboundRate)} item/min\n${itemName || "Item"} outputs: ${groups.map(() => `${fmt(childRate)} item/min`).join(", ")}`, "splitter", factor);
      groups.forEach((group, groupIndex) => {
        const groupPoint = { x: group.reduce((sum, point) => sum + point.x, 0) / group.length, y: nodeY };
        addBelt(belts, itemColor, childRate * group.length, routeOutOfPort(ports.outputs[groupIndex].point, groupPoint, ports.outputs[groupIndex].kind), itemName, NODE_ARROW_PROTECTION, 0, `${itemName}:splitter-output-${groupIndex + 1}`, `${itemName}:splitter-group-${groupIndex + 1}`);
        if (factorIndex === factors.length - 1) {
          group.forEach((point, pointIndex) => addBelt(belts, itemColor, totalRate / targetPoints.length, routeHV(groupPoint, point), itemName, 0, 0, `${itemName}:splitter-leaf-source-${pointIndex + 1}`, `${itemName}:splitter-leaf-target-${pointIndex + 1}`));
        } else {
          recurse(groupPoint, group, factorIndex + 1, nextY);
        }
      });
    }

    recurse(startPoint, targetPoints, 0, levelBaseY);
  }

  function connectMergerTree(sourcePoints, targetPoint, itemColor, totalRate, levelBaseY, itemName) {
    if (sourcePoints.length === 1) {
      addBelt(outputBelts, itemColor, totalRate, routeHV(sourcePoints[0], targetPoint), itemName, 0, 0, `${itemName}:source`, `${itemName}:target`);
      return;
    }

    const factors = findExactFactorChain(sourcePoints.length, solution.settings.mergerSizes)?.slice().reverse();
    if (!factors?.length) {
      const nodeX = sourcePoints.reduce((sum, point) => sum + point.x, 0) / sourcePoints.length;
      const nodeY = levelBaseY;
      const ports = getMergerPorts(nodeX, nodeY, sourcePoints.length);
      const branchRate = totalRate / sourcePoints.length;
      sourcePoints.forEach((point, index) => addBelt(outputBelts, itemColor, branchRate, routeIntoPort(point, ports.inputs[index].point, ports.inputs[index].kind), itemName, 0, NODE_ARROW_PROTECTION, `${itemName}:source-${index + 1}`, `${itemName}:merger-input-${index + 1}`));
      addRoutingNode(nodeX, nodeY, itemColor, `Merger\n${itemName || "Item"} inputs: ${sourcePoints.map(() => `${fmt(branchRate)} item/min`).join(", ")}\n${itemName || "Item"} output: ${fmt(totalRate)} item/min`, "merger", sourcePoints.length);
      addBelt(outputBelts, itemColor, totalRate, routeMergerOutputTopOnly(ports.output.point, targetPoint), itemName, NODE_ARROW_PROTECTION, 0, `${itemName}:merger-output`, `${itemName}:target`);
      return;
    }

    let currentPoints = sourcePoints.slice();
    let y = levelBaseY;
    for (let factorIndex = 0; factorIndex < factors.length; factorIndex += 1) {
      const factor = factors[factorIndex];
      const groupSize = factor;
      const groupCount = currentPoints.length / groupSize;
      const nextPoints = [];
      for (let index = 0; index < groupCount; index += 1) {
        const group = currentPoints.slice(index * groupSize, (index + 1) * groupSize);
        const nodeX = group.reduce((sum, point) => sum + point.x, 0) / group.length;
        const nodeY = y;
        const ports = getMergerPorts(nodeX, nodeY, group.length);
        const branchRate = totalRate / sourcePoints.length;
        group.forEach((point, pointIndex) => addBelt(outputBelts, itemColor, branchRate, routeIntoPort(point, ports.inputs[pointIndex].point, ports.inputs[pointIndex].kind), itemName, 0, NODE_ARROW_PROTECTION, `${itemName}:source-${pointIndex + 1}`, `${itemName}:merger-input-${pointIndex + 1}`));
        addRoutingNode(nodeX, nodeY, itemColor, `Merger\n${itemName || "Item"} inputs: ${group.map(() => `${fmt(branchRate)} item/min`).join(", ")}\n${itemName || "Item"} output: ${fmt(branchRate * group.length)} item/min`, "merger", group.length);
        nextPoints.push(ports.output.point);
      }
      currentPoints = nextPoints;
      y -= 34;
    }
    addBelt(outputBelts, itemColor, totalRate, routeMergerOutputTopOnly(currentPoints[0], targetPoint), itemName, 0, 0, `${itemName}:merger-output`, `${itemName}:target`);
  }

  function buildNodeVisuals(node) {
    const pos = positions.get(node);
    const children = node.children || [];
    if (node.type === "external") {
      const itemColor = getNodeItemColor(node, itemMap);
      const sourceBottomY = pos.y + 34;
      const sourceTopY = pos.y - 18;
      addBelt(outputBelts, itemColor, node.rate, [{ x: pos.x, y: sourceBottomY }, { x: pos.x, y: sourceTopY }], node.label, 0, 0, `${node.label}:external-source`, `${node.label}:external-output`);
      extendBounds(layoutBounds, pos.x - 80, pos.y - 24);
      extendBounds(layoutBounds, pos.x + 80, pos.y + 70);
      return { outputX: pos.x, outputY: sourceTopY, itemColor, rate: node.rate, outputs: [{ x: pos.x, y: sourceTopY, rate: node.rate }] };
    }

    const machineCount = Math.max(1, node.machineCount || 1);
    const instanceClocks = node.instanceClocks?.length ? node.instanceClocks : [100];
    const instanceRates = node.instanceRates?.length ? node.instanceRates : [node.actualRate || node.requiredRate || 0];
    const instanceSpacing = 220;
    const machineCenters = Array.from({ length: machineCount }, (_, index) => pos.x + (index - (machineCount - 1) / 2) * instanceSpacing);
    const machineWidth = computeMachineWidth(children.length || 1);
    const machineBottomY = pos.y + machineHeight / 2;
    const machineTopY = pos.y - machineHeight / 2;
    const machineInputY = pos.y;
    const machineOutputY = pos.y;
    const outputTipY = machineTopY - MACHINE_PORT_STEM - machineNodeGap - 38;
    const outputItemColor = getNodeItemColor(node, itemMap);
    const inputColors = children.map((child) => getNodeItemColor(child, itemMap));
    const machineColor = averageHexColors([...inputColors, outputItemColor]);
    const machineTextColor = contrastColor(machineColor);
    const machineInputSlots = machineCenters.map((centerX) => getMachineInputSlotXs(centerX, machineWidth, children.length || 1));
    const machineArrowProtection = machineHeight / 2 + ROUTING_NODE_DIAMETER;

    const splitterY = machineBottomY + machineNodeGap + 46;
    const mergerY = machineTopY - machineNodeGap - 46;

    children.forEach((child, index) => {
      const childVisual = buildNodeVisuals(child);
      const directParallel =
        machineCount > 1 &&
        childVisual.outputs &&
        childVisual.outputs.length === machineCount;

      if (directParallel) {
        const orderedOutputs = [...childVisual.outputs].sort((a, b) => a.x - b.x);
        orderedOutputs.forEach((output, outputIndex) => {
          const targetX = machineInputSlots[outputIndex][index] ?? machineCenters[outputIndex];
          addBelt(
            belts,
            childVisual.itemColor,
            output.rate,
            compressPoints(routeHV({ x: output.x, y: output.y }, { x: targetX, y: machineInputY })),
            child.label,
            0,
            machineArrowProtection,
            `${child.label}:output-${outputIndex + 1}`,
            `${node.label}:machine-input-${outputIndex + 1}-${index + 1}`
          );
        });
      } else if (machineCount === 1) {
        const targetX = machineInputSlots[0][index] ?? machineCenters[0];
        addBelt(
          belts,
            childVisual.itemColor,
            childVisual.rate,
            compressPoints(routeHV({ x: childVisual.outputX, y: childVisual.outputY }, { x: targetX, y: machineInputY })),
            child.label,
            0,
            machineArrowProtection,
            `${child.label}:output`,
            `${node.label}:machine-input-${index + 1}`
          );
      } else {
        const targetPoints = machineCenters.map((centerX, machineIndex) => ({
          x: machineInputSlots[machineIndex][index] ?? centerX,
          y: machineInputY
        }));
        connectSplitterTree(
          { x: childVisual.outputX, y: childVisual.outputY },
          targetPoints,
          childVisual.itemColor,
          childVisual.rate,
          splitterY + index * 16,
          child.label
        );
      }
    });

    const outputRate = node.actualRate || node.requiredRate || 0;

    if (machineCount === 1) {
      addBelt(outputBelts, outputItemColor, outputRate, [{ x: machineCenters[0], y: machineOutputY }, { x: machineCenters[0], y: outputTipY }], node.label, machineArrowProtection, 0, `${node.label}:machine-output`, `${node.label}:output-tip`);
    } else {
      const sourcePoints = machineCenters.map((centerX) => ({ x: centerX, y: machineTopY - machineNodeGap }));
      machineCenters.forEach((centerX, machineIndex) => {
        const instanceRate = instanceRates[machineIndex] || 0;
        addBelt(outputBelts, outputItemColor, instanceRate, [{ x: centerX, y: machineOutputY }, { x: centerX, y: machineTopY - machineNodeGap }], node.label, machineArrowProtection, 0, `${node.label}:machine-output-${machineIndex + 1}`, `${node.label}:merge-source-${machineIndex + 1}`);
      });
      connectMergerTree(sourcePoints, { x: pos.x, y: outputTipY }, outputItemColor, outputRate, mergerY, node.label);
    }

    machineCenters.forEach((centerX, machineIndex) => {
      const instanceRate = instanceRates[machineIndex] || 0;
      const instanceClock = instanceClocks[machineIndex] || 100;
      renderedNodes.push(`
        <g class="factory-machine">
          <rect x="${centerX - machineWidth / 2}" y="${pos.y - machineHeight / 2}" width="${machineWidth}" height="${machineHeight}" fill="${machineColor}" stroke="rgba(60,48,31,0.85)" stroke-width="2"></rect>
          <text x="${centerX}" y="${pos.y - 12}" text-anchor="middle" class="factory-machine-label" fill="${machineTextColor}">${escapeHtml(node.machineName)}</text>
          <text x="${centerX}" y="${pos.y + 8}" text-anchor="middle" class="factory-machine-sub" fill="${machineTextColor}">${escapeHtml(`${node.label} · ${fmt(instanceRate)} item/min`)}</text>
          <text x="${centerX}" y="${pos.y + 28}" text-anchor="middle" class="factory-machine-sub" fill="${machineTextColor}">${escapeHtml(`${fmt(instanceClock)}%`)}</text>
        </g>
      `);
      extendBounds(layoutBounds, centerX - machineWidth / 2, pos.y - machineHeight / 2);
      extendBounds(layoutBounds, centerX + machineWidth / 2, pos.y + machineHeight / 2);
    });

    extendBounds(layoutBounds, pos.x - 40, outputTipY - 12);
    extendBounds(layoutBounds, pos.x + 40, outputTipY);

    return {
      outputX: pos.x,
      outputY: outputTipY,
      itemColor: outputItemColor,
      rate: outputRate,
      outputs: machineCenters.map((centerX, machineIndex) => ({
        x: centerX,
        y: machineTopY - machineNodeGap,
        rate: instanceRates[machineIndex] || 0
      }))
    };
  }

  buildNodeVisuals(solution.targetNode);
  debugLog(7, 4, "Node visuals complete", {
    renderedNodeCount: renderedNodes.length,
    beltCount: belts.length,
    outputBeltCount: outputBelts.length
  });
  if (layoutInvalidReason) {
    return `
      <svg viewBox="0 0 1200 480" role="img" aria-label="Solver board">
        <text x="600" y="200" text-anchor="middle" class="board-placeholder">No layout</text>
        <text x="600" y="230" text-anchor="middle" class="board-placeholder-sub">${escapeHtml(layoutInvalidReason)}</text>
      </svg>
    `;
  }
  const pruneIllegalRoutingSegments = (collection) => {
    collection.forEach((belt) => {
      belt.segments = belt.segments.filter((segment) => {
        if (!segmentIsVertical(segment)) return true;
        return !routingNodeMeta.some((nodeMeta) => {
          const touchesNodeX = Math.abs(segment.x1 - nodeMeta.x) < 0.01;
          if (!touchesNodeX) return false;
          if (nodeMeta.role === "splitter") {
            const topPortY = nodeMeta.y - ROUTING_NODE_RADIUS;
            if (nodeMeta.branchCount === 2) {
              return Math.min(segment.y1, segment.y2) <= topPortY + 0.01 &&
                Math.max(segment.y1, segment.y2) >= topPortY - 0.01 &&
                Math.min(segment.y1, segment.y2) < nodeMeta.y;
            }
            return segmentDirection(segment) === "down" &&
              Math.min(segment.y1, segment.y2) <= topPortY + 0.01 &&
              Math.max(segment.y1, segment.y2) >= topPortY - 0.01;
          }
          if (nodeMeta.role === "merger" && nodeMeta.branchCount === 2) {
            const bottomPortY = nodeMeta.y + ROUTING_NODE_RADIUS;
            return segmentDirection(segment) === "up" &&
              Math.min(segment.y1, segment.y2) <= bottomPortY + 0.01 &&
              Math.max(segment.y1, segment.y2) >= bottomPortY - 0.01;
          }
          return false;
        });
      });
    });
  };
  pruneIllegalRoutingSegments(belts);
  pruneIllegalRoutingSegments(outputBelts);
  resolveParallelOverlaps(belts);
  resolveParallelOverlaps(outputBelts);
  markOverpasses(belts);
  markOverpasses(outputBelts);
  [...belts, ...outputBelts].forEach((belt) => {
    belt.segments.forEach((segment) => {
      extendBounds(layoutBounds, segment.x1, segment.y1);
      extendBounds(layoutBounds, segment.x2, segment.y2);
    });
  });
  const padding = 48;
  const shiftX = Number.isFinite(layoutBounds.minX) ? Math.max(0, padding - layoutBounds.minX) : 0;
  const shiftY = Number.isFinite(layoutBounds.minY) ? Math.max(0, padding - layoutBounds.minY) : 0;
  const contentWidth = Number.isFinite(layoutBounds.maxX) ? layoutBounds.maxX - layoutBounds.minX + padding * 2 : width;
  const contentHeight = Number.isFinite(layoutBounds.maxY) ? layoutBounds.maxY - layoutBounds.minY + padding * 2 : height;
  const viewWidth = Math.max(width, contentWidth);
  const viewHeight = Math.max(height, contentHeight);
  debugLog(7, 5, "Viewport resolved", { layoutBounds, shiftX, shiftY, viewWidth, viewHeight });

  return `
    <svg viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="Factory layout board">
      <g transform="translate(${shiftX} ${shiftY})">
        ${[...belts, ...outputBelts].map(renderFactoryBelt).join("")}
        ${renderedNodes.join("")}
      </g>
    </svg>
  `;
}

function openRecipeModal(recipeId = "") {
  const recipe = recipeId ? state.recipes.find((entry) => entry.id === recipeId) : null;
  recipeModalState.open = true;
  recipeModalState.recipeId = recipeId || "";
  recipeModalState.mode = recipe ? "edit" : "create";
  recipeModalState.draft = createRecipeDraft(recipe || emptyRecipe());
  document.body.style.overflow = "hidden";
  renderRecipeModal();
}

function closeRecipeModal() {
  recipeModalState.open = false;
  recipeModalState.recipeId = "";
  recipeModalState.draft = emptyRecipe();
  document.body.style.overflow = "";
  renderRecipeModal();
}

function saveRecipeModal() {
  const draft = sanitizeRecipe(recipeModalState.draft);
  const validation = getRecipeValidation(recipeModalState.draft);
  if (!validation.valid) return;

  if (recipeModalState.recipeId) {
    const index = state.recipes.findIndex((entry) => entry.id === recipeModalState.recipeId);
    if (index >= 0) state.recipes[index] = draft;
  } else {
    state.recipes.push(draft);
  }

  ensureStateStructure();
  const duplicates = getDuplicateRecipeGroups();
  if ([...duplicates.values()].some((ids) => ids.includes(draft.id))) {
    alert("Duplicate recipe detected. Both recipe cards are marked in yellow. Only the first instance will be used during calculation.");
  }
  closeRecipeModal();
  render();
}

function renderColorPicker() {
  const root = document.getElementById("color-picker-root");
  if (!root) return;
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
    <div class="color-picker-backdrop" data-color-picker-close></div>
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
        <button type="button" class="secondary" data-color-picker-close>Cancel</button>
        <button type="button" data-color-picker-apply>Apply</button>
      </div>
    </div>
  `;
  attachColorPickerEvents();
}

function syncColorPickerUi(container = document) {
  const svArea = container.querySelector("[data-color-picker-sv]");
  const svHandle = container.querySelector(".color-picker-handle");
  const hueHandle = container.querySelector(".color-hue-handle");
  const preview = container.querySelector(".color-preview-box");
  const hexValue = container.querySelector("[data-color-picker-hex]");
  const rgbValue = container.querySelector("[data-color-picker-rgb]");
  const pill = container.querySelector("[data-color-picker-pill]");
  if (!svArea || !svHandle || !hueHandle || !preview || !hexValue || !rgbValue || !pill) return;

  const hueRgb = hsvToRgb(colorPickerState.hue, 100, 100);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const rgb = hexToRgb(colorPickerState.draftHex);
  svArea.style.background = hueColor;
  svHandle.style.left = `${colorPickerState.sat}%`;
  svHandle.style.top = `${100 - colorPickerState.val}%`;
  hueHandle.style.top = `${(colorPickerState.hue / 360) * 100}%`;
  preview.style.background = colorPickerState.draftHex;
  hexValue.textContent = colorPickerState.draftHex;
  rgbValue.textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  pill.textContent = colorPickerState.draftHex;
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
      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        move(moveEvent.clientX, moveEvent.clientY);
      };
      const stop = (endEvent) => {
        if (endEvent.pointerId !== event.pointerId) return;
        if (typeof element.releasePointerCapture === "function" && element.hasPointerCapture?.(endEvent.pointerId)) {
          element.releasePointerCapture(endEvent.pointerId);
        }
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", stop);
        element.removeEventListener("pointercancel", stop);
      };
      element.addEventListener("pointermove", onMove);
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

function renderRecipeModal() {
  const root = document.getElementById("recipe-modal-root");
  if (!root) return;
  if (!recipeModalState.open) {
    root.innerHTML = "";
    return;
  }

  const items = getDefinedItems();
  const machineClasses = getDefinedMachineClasses();
  const roleState = deriveItemRoles();
  const draft = recipeModalState.draft;
  const validation = getRecipeValidation(draft);
  const duplicateInputIds = validation.duplicateInputIds;
  const outputSelectableItems = items.filter((item) => !roleState.externalInputIds.has(item.id));

  root.innerHTML = `
    <div class="modal-backdrop" data-recipe-modal-close></div>
    <div class="modal-popup" role="dialog" aria-modal="true" aria-label="Recipe editor">
      <div class="modal-header">
        <strong>${recipeModalState.mode === "edit" ? "Edit Recipe" : "Add Recipe"}</strong>
        <span class="pill">${validation.valid ? "Valid" : "Incomplete"}</span>
      </div>
      <div class="modal-section recipe-modal-grid">
        <div class="recipe-grid-machine">
          <label class="field-label">Machine class</label>
          <select data-recipe-draft="machineClassId">
            <option value="">Select machine class</option>
            ${machineClasses.map((machine) => `<option value="${machine.id}" ${machine.id === draft.machineClassId ? "selected" : ""}>${escapeHtml(machine.name)}</option>`).join("")}
          </select>
        </div>
        <div class="recipe-grid-output">
          <label class="field-label">Produced item</label>
          <select data-recipe-draft="outputItemId">
            <option value="">Select output item</option>
            ${outputSelectableItems.map((item) => `<option value="${item.id}" ${item.id === draft.outputItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
          <label class="field-label" style="margin-top:8px">Output quantity per craft</label>
          <input type="text" value="${escapeHtml(draft.outputQty)}" data-recipe-draft="outputQty">
        </div>
        <div class="recipe-grid-rate">
          <label class="field-label">Items per minute</label>
          <input type="text" value="${escapeHtml(draft.itemsPerMinute)}" data-recipe-draft="itemsPerMinute">
        </div>
      </div>
      <div class="modal-section">
        <div class="field-label">Inputs</div>
        <div class="modal-grid">
          ${draft.inputs.map((row) => {
            const selectedIds = draft.inputs.filter((entry) => entry.id !== row.id && entry.itemId).map((entry) => entry.itemId);
            return `
              <div class="modal-row">
                <select data-recipe-draft="input-item" data-row-id="${row.id}">
                  <option value="">Select input item</option>
                  ${items.filter((item) => !selectedIds.includes(item.id) || item.id === row.itemId).map((item) => `<option value="${item.id}" ${item.id === row.itemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
                </select>
                <input type="text" value="${escapeHtml(row.qty)}" placeholder="Qty per craft" data-recipe-draft="input-qty" data-row-id="${row.id}">
                <div class="footnote ${duplicateInputIds.has(row.itemId) ? "warning-text" : ""}">${duplicateInputIds.has(row.itemId) ? "Duplicate input" : ""}</div>
              </div>
            `;
          }).join("")}
        </div>
        ${draft.machineClassId && !validation.inputCountAllowed ? `<p style="color:red">Filled input count ${validation.filledInputCount} does not match the selected machine class allowed set.</p>` : ""}
        ${validation.incompleteFilledRows ? `<p style="color:red">Each filled input row must have both an item and a quantity greater than 0.</p>` : ""}
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" data-recipe-modal-close>Cancel</button>
        <button type="button" class="${validation.valid ? "modal-done-ready" : "modal-done-disabled"}" data-recipe-modal-save ${validation.valid ? "" : "disabled"}>Done</button>
      </div>
    </div>
  `;
  attachRecipeModalEvents();
}

function syncRecipeModalUi() {
  const root = document.getElementById("recipe-modal-root");
  if (!root || !recipeModalState.open) return;
  const validation = getRecipeValidation(recipeModalState.draft);
  const pill = root.querySelector(".modal-header .pill");
  const saveButton = root.querySelector("[data-recipe-modal-save]");
  if (pill) pill.textContent = validation.valid ? "Valid" : "Incomplete";
  if (saveButton) {
    saveButton.disabled = !validation.valid;
    saveButton.className = validation.valid ? "modal-done-ready" : "modal-done-disabled";
  }
}

function commitRecipeDraftField(field, rowId = "") {
  const draft = recipeModalState.draft;
  if (field === "itemsPerMinute") {
    draft.itemsPerMinute = normalizeNumericString(draft.itemsPerMinute, 6);
  } else if (field === "outputQty") {
    draft.outputQty = normalizeNumericString(draft.outputQty, 6);
  } else if (field === "input-qty") {
    const row = draft.inputs.find((entry) => entry.id === rowId);
    if (row) row.qty = normalizeNumericString(row.qty, 6);
  }
}

function attachRecipeModalEvents() {
  const root = document.getElementById("recipe-modal-root");
  if (!root) return;

  root.querySelectorAll("[data-recipe-modal-close]").forEach((element) => {
    element.onclick = () => closeRecipeModal();
  });

  const saveButton = root.querySelector("[data-recipe-modal-save]");
  if (saveButton) saveButton.onclick = () => saveRecipeModal();

  root.querySelectorAll("[data-recipe-draft]").forEach((element) => {
    element.oninput = (event) => {
      const field = element.dataset.recipeDraft;
      if (field === "input-item" || field === "input-qty") {
        const row = recipeModalState.draft.inputs.find((entry) => entry.id === element.dataset.rowId);
        if (!row) return;
        if (field === "input-item") row.itemId = event.target.value;
        else row.qty = event.target.value;
      } else {
        recipeModalState.draft[field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      }
      syncRecipeModalUi();
    };
    element.onchange = (event) => {
      const field = element.dataset.recipeDraft;
      if (field === "input-item") {
        const row = recipeModalState.draft.inputs.find((entry) => entry.id === element.dataset.rowId);
        if (!row) return;
        row.itemId = event.target.value;
        syncRecipeModalUi();
        return;
      }
      if (field === "outputItemId" || field === "machineClassId") {
        recipeModalState.draft[field] = event.target.value;
        if (field === "machineClassId") {
          syncDraftInputRowsToMachine(recipeModalState.draft);
          renderRecipeModal();
          return;
        }
        syncRecipeModalUi();
      }
    };
    element.onblur = () => {
      const field = element.dataset.recipeDraft;
      commitRecipeDraftField(field, element.dataset.rowId);
      syncRecipeModalUi();
    };
    element.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    };
  });
}

function render() {
  ensureStateStructure();
  saveLocal();

  const solution = solveFactory();
  debugLog(8, 1, "UI render start", {
    itemCount: getDefinedItems().length,
    machineClassCount: getDefinedMachineClasses().length,
    recipeCount: state.recipes.length,
    reachable: solution.reachable
  });
  const items = getDefinedItems();
  const machineClasses = getDefinedMachineClasses();
  const beltSpeedRows = state.settings.beltSpeeds;
  const beltSpeedStatuses = getBeltSpeedStatuses();
  const roleState = deriveItemRoles();
  const itemStatuses = getItemRowStatuses();
  const machineStatuses = getMachineClassStatuses();
  const duplicateRecipes = solution.duplicateIds;
  const beltSpeedOptions = getSettingsNumbers().beltSpeeds.map((entry) => entry.speedText);
  const targetItems = items.filter((item) => !roleState.externalInputIds.has(item.id));
  const clockMin = getClockSliderValue(state.settings.clockMin || 25);
  const clockMax = 100;
  const sliderLeft = ((clockMin - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const avoidedInvalidCases = [
    "Arrow placement is kept out of protected zones around machines and routing nodes.",
    "Belts are routed with orthogonal segments and parallel overlaps are shifted apart.",
    "Machine inputs remain bottom-only and machine outputs remain top-center only."
  ];
  const exampleEdgeCases = [
    "A target that exceeds raw input supply stays invalid and reports the exact missing quantity.",
    "A flow above the fastest belt speed emits a warning and continues with the fastest belt.",
    "Duplicate recipes are marked and ignored after the first matching instance."
  ];

  document.getElementById("app").innerHTML = `
    <div class="top-area">
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="toolbar-title">FlowForge</div>
          <span class="pill">${items.length} items</span>
          <span class="pill">${machineClasses.length} machine classes</span>
          <span class="pill">${state.recipes.length} recipes</span>
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
              <div class="item-row ${itemStatuses.get(row.id)?.valid ? "valid" : ""}">
                <div class="row cols-4">
                  <div>
                    <label class="field-label">Item name</label>
                    <input type="text" value="${escapeHtml(row.name)}" data-item-field="name" data-item-id="${row.id}">
                  </div>
                  <div>
                    <label class="field-label">Item color</label>
                    <input type="text" value="${escapeHtml(row.color)}" data-item-field="color" data-item-id="${row.id}">
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
                  ${itemStatuses.get(row.id)?.valid
                    ? `Registered as <strong>${escapeHtml(row.name.trim())}</strong>.`
                    : index === state.itemRows.length - 1
                      ? "Leave one empty row available for the next item."
                      : "Provide a unique name and a unique valid CSS color."}
                </div>
              </div>
            `).join("")}
          </div>

          <h3>Item Cards</h3>
          <div class="item-card-grid">
            ${items.length ? items.map((item) => `
              <div class="item-card" style="--item-color:${escapeHtml(item.color)}">
                <div class="item-card-header">
                  <div class="item-name">${escapeHtml(item.name)}</div>
                  <div class="color-chip" style="background:${escapeHtml(item.color)}"></div>
                </div>
                <div class="subtle">External input belts</div>
                <div class="belt-rows">
                  ${(() => {
                    const realInputExists = hasRealBeltInput(item);
                    return item.belts.map((belt, beltIndex) => `
                      <div class="belt-row">
                        <select data-belt-item="${item.id}" data-belt-id="${belt.id}">
                          ${beltIndex === 0 ? `<option value="__ONLY_OUTPUT__" ${!realInputExists ? "selected" : ""}>ONLY OUTPUT</option>` : ""}
                          ${beltIndex > 0 ? `<option value="" ${belt.value === "" ? "selected" : ""}></option>` : ""}
                          ${beltSpeedOptions.map((speed) => `<option value="${escapeHtml(speed)}" ${String(belt.value) === speed ? "selected" : ""}>${escapeHtml(speed)}</option>`).join("")}
                        </select>
                        <span class="unit">item/min</span>
                      </div>
                    `).join("");
                  })()}
                </div>
              </div>
            `).join("") : `
              <div class="item-card" style="--item-color:#777">
                <div class="item-card-header"><div class="item-name">No items yet</div><div class="color-chip" style="background:#777"></div></div>
                <div class="subtle">Define an item above to unlock belts, machine classes, recipes, and the solver.</div>
              </div>
            `}
          </div>
        </section>

        <section class="panel">
          <h2>Global Settings</h2>
          <div class="settings-grid">
            <div class="settings-span-2">
              <label class="field-label">Available belt speeds</label>
              <div class="belt-speed-config">
                ${beltSpeedRows.map((row, index) => `
                  <div class="belt-speed-row ${beltSpeedStatuses.get(row.id)?.valid ? "valid" : ""}">
                    <input type="text" value="${escapeHtml(row.speed)}" placeholder="Speed" data-belt-speed-field="speed" data-belt-speed-id="${row.id}">
                    <input type="text" value="${escapeHtml(row.color)}" placeholder="Arrow color" data-belt-speed-field="color" data-belt-speed-id="${row.id}">
                    <div class="speed-swatch" style="background:${isValidColor(row.color) ? escapeHtml(row.color) : "#555"}"></div>
                    <div class="footnote">
                      ${beltSpeedStatuses.get(row.id)?.valid
                        ? `${escapeHtml(fmt(parseNumber(row.speed) || 0))} item/min`
                        : index === beltSpeedRows.length - 1
                          ? "Leave one empty row available for the next belt speed."
                          : "Provide a unique numeric speed and a valid color."}
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
            <div><label class="field-label">Maximum available power</label><input type="text" value="${escapeHtml(state.settings.maxPower)}" data-setting="maxPower"></div>
            <div>
              <label class="field-label">Target output item</label>
              <select data-setting="targetOutputItemId">
                <option value="">Select target</option>
                ${targetItems.map((item) => `<option value="${item.id}" ${item.id === state.settings.targetOutputItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label class="field-label">Target output rate (item/min)</label>
              <input type="text" value="${escapeHtml(state.settings.targetOutputRate)}" data-setting="targetOutputRate">
            </div>
            <div class="stat-row">
              <div>Enable overflow belts</div>
              <div><input type="checkbox" data-setting-check="enableOverflow" ${state.settings.enableOverflow ? "checked" : ""}></div>
            </div>
            <div class="clock-panel settings-span-2">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <strong>Minimum remainder clock</strong>
                <span class="pill">${fmt(getSettingsNumbers().minClock)}% to 100%</span>
              </div>
              <div class="dual-slider">
                <div class="dual-slider-track"></div>
                <div class="dual-slider-fill" style="left:${sliderLeft}%;right:0%"></div>
                <input type="range" min="${CLOCK_SLIDER_MIN}" max="${CLOCK_SLIDER_MAX}" step="${CLOCK_STEP}" value="${escapeHtml(String(clockMin))}" data-clock-slider="min">
              </div>
              <div class="clock-values">
                <div><label class="field-label">Minimum allowed remainder clock</label><input type="text" value="${escapeHtml(state.settings.clockMin)}" data-setting="clockMin"></div>
                <div class="mini-summary"><strong>Maximum clock</strong><br>100%</div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Result Summary</h2>
          <div class="summary-list">
            <div class="stat-row"><div>Target reachable</div><div class="value ${solution.reachable ? "ok-text" : "warning-text"}">${solution.reachable ? "Yes" : "No"}</div></div>
            <div class="stat-row"><div>Machine classes</div><div class="value">${machineClasses.length}</div></div>
            <div class="stat-row"><div>Total power</div><div class="value ${solution.totalPower > getSettingsNumbers().maxPower ? "danger-text" : ""}">${fmt(solution.totalPower || 0)} / ${fmt(getSettingsNumbers().maxPower)} MW</div></div>
            <div class="stat-row"><div>Overflow belts</div><div class="value">${solution.overflowBelts.length}</div></div>
          </div>

          <h3>External Input Totals</h3>
          <div class="summary-list">
            ${items.length ? items.map((item) => `<div class="stat-row"><div>${escapeHtml(item.name)}</div><div class="value">${fmt(solution.externalTotals.get(item.id) || 0)} item/min</div></div>`).join("") : `<div class="footnote">No items defined yet.</div>`}
          </div>

          <h3>Warnings And Errors</h3>
          <div class="summary-list">
            ${solution.warnings.length ? solution.warnings.map((warning) => `<div class="mini-summary warning-text">${escapeHtml(warning)}</div>`).join("") : ""}
            ${solution.errors.length ? solution.errors.map((error) => `<div class="mini-summary danger-text">${escapeHtml(error)}</div>`).join("") : ""}
            ${!solution.warnings.length && !solution.errors.length ? `<div class="mini-summary ok-text">No active warnings. The solver has a consistent state.</div>` : ""}
          </div>
        </section>
      </div>

      <section class="recipes-shell">
        <div class="recipes-header">
          <div>
            <strong>Machine Classes</strong>
            <div class="footnote">Machine classes contain only machine name and power usage at 100% clock.</div>
          </div>
        </div>
        <div class="stack">
          ${state.machineClassRows.map((row, index) => `
            <div class="item-row ${machineStatuses.get(row.id)?.valid ? "valid" : ""}">
              <div class="row cols-3">
                <div>
                  <label class="field-label">Machine name</label>
                  <input type="text" value="${escapeHtml(row.name)}" data-machine-field="name" data-machine-id="${row.id}">
                </div>
                <div>
                  <label class="field-label">Power usage at 100%</label>
                  <input type="text" value="${escapeHtml(row.power)}" data-machine-field="power" data-machine-id="${row.id}">
                </div>
                <div>
                  <label class="field-label">Allowed input counts</label>
                  <input type="text" value="${escapeHtml(row.inputCounts)}" data-machine-field="inputCounts" data-machine-id="${row.id}" placeholder="1 or 2, 3">
                </div>
              </div>
              <div class="footnote">
                ${machineStatuses.get(row.id)?.valid
                  ? `Registered as <strong>${escapeHtml(row.name.trim())}</strong>.`
                  : index === state.machineClassRows.length - 1
                    ? "Leave one empty row available for the next machine class."
                    : "Machine class names must be unique, power must be numeric, and allowed input counts must be an exact comma-separated set."}
              </div>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="recipes-shell">
        <div class="recipes-header">
          <div>
            <strong>Recipes</strong>
            <div class="footnote">Recipes are edited only through the modal editor. Duplicate recipes are highlighted in yellow and ignored after the first instance.</div>
          </div>
        </div>
        <div class="recipe-card-list">
          ${state.recipes.length ? state.recipes.map((recipe) => {
            const outputItem = items.find((item) => item.id === recipe.outputItemId);
            const machine = machineClasses.find((entry) => entry.id === recipe.machineClassId);
            return `
              <div class="recipe-card ${duplicateRecipes.has(recipe.id) ? "recipe-card-duplicate" : ""}">
                <div class="stat-row">
                  <div><strong>${escapeHtml(outputItem?.name || "Missing output")}</strong></div>
                  <div class="value">${escapeHtml(machine?.name || "Missing machine")}</div>
                </div>
                <div class="stat-row">
                  <div>${escapeHtml(fmt(parseNumber(recipe.itemsPerMinute) || 0))} item/min</div>
                  <div class="value">${escapeHtml(fmt(parseNumber(recipe.outputQty) || 0))} / craft</div>
                </div>
                <div class="recipe-card-actions">
                  <button type="button" class="secondary" data-edit-recipe="${recipe.id}">Edit</button>
                </div>
              </div>
            `;
          }).join("") : `<div class="mini-summary">No recipes defined yet.</div>`}
        </div>
        <div style="margin-top:10px">
          <button type="button" data-action="add-recipe">+ Add Recipe</button>
        </div>
      </section>

      <div class="summary-strip">
        <div class="mini-summary">
          <h4>Validation Result</h4>
          <div class="footnote ${solution.reachable ? "ok-text" : "danger-text"}">${solution.reachable ? "VALID" : "INVALID"}</div>
        </div>
        <div class="mini-summary">
          <h4>Machine Plan</h4>
          ${solution.machinePlans.length
            ? solution.machinePlans.map((plan) => `<div class="footnote">${escapeHtml(plan.outputItemName)}: ${plan.machineCount}x ${escapeHtml(plan.machineName)} at ${fmt(plan.clock)}%</div>`).join("")
            : `<div class="footnote">No machine requirements yet.</div>`}
        </div>
        <div class="mini-summary">
          <h4>External Demand</h4>
          ${solution.externalDemand && solution.externalDemand.size
            ? [...solution.externalDemand.entries()].map(([itemId, demand]) => `<div class="footnote">${escapeHtml(solution.roleState.itemMap.get(itemId)?.name || "Unknown")}: ${fmt(demand)} /min</div>`).join("")
            : `<div class="footnote">No external demand yet.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Overflow Belts</h4>
          ${solution.overflowBelts.length
            ? solution.overflowBelts.map((belt) => `<div class="footnote">Belt ${belt.id}: ${escapeHtml(belt.itemName)} ${fmt(belt.rate)} /min</div>`).join("")
            : `<div class="footnote">No overflow belts assigned.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Duplicates</h4>
          ${solution.duplicateIds.size
            ? `<div class="footnote warning-text">${solution.duplicateIds.size} duplicate recipe card(s) ignored after the first matching instance.</div>`
            : `<div class="footnote">No duplicate recipes detected.</div>`}
        </div>
        <div class="mini-summary">
          <h4>Avoided Invalid Cases</h4>
          ${avoidedInvalidCases.map((entry) => `<div class="footnote">${escapeHtml(entry)}</div>`).join("")}
        </div>
        <div class="mini-summary">
          <h4>Example Edge Cases</h4>
          ${exampleEdgeCases.map((entry) => `<div class="footnote">${escapeHtml(entry)}</div>`).join("")}
        </div>
      </div>
    </div>

      <section class="board-shell">
        <div class="board-header">
          <div>
          <strong>Factory Layout</strong>
          <div class="footnote">Automatically derived geometric belt plan for the current target output.</div>
          </div>
        </div>
        <div class="board-stage">${renderSolverBoard(solution)}</div>
    </section>
    ${solution.errors.length ? `<div class="app-errors">${solution.errors.map((error) => `<p style="color:red">${escapeHtml(error)}</p>`).join("")}</div>` : ""}
  `;

  attachEvents();
  renderColorPicker();
  renderRecipeModal();
  debugLog(8, 2, "UI render finish", {
    warningCount: solution.warnings.length,
    errorCount: solution.errors.length
  });
}

function commitSettings(normalizeStrings = true) {
  const min = Math.max(CLOCK_SLIDER_MIN, Math.min(parseNumber(state.settings.clockMin) ?? APP_CONFIG.clock.defaultMin, APP_CONFIG.clock.max));
  state.settings.clockMin = normalizeStrings ? normalizeNumericString(String(min), 2) : String(min);
  state.settings.clockMax = String(APP_CONFIG.clock.max);
  if (normalizeStrings) {
    const maxPower = parseNumber(state.settings.maxPower);
    state.settings.maxPower = maxPower === null ? "" : normalizeNumericString(String(maxPower), 4);
    const targetRate = parseNumber(state.settings.targetOutputRate);
    state.settings.targetOutputRate = targetRate === null ? "" : normalizeNumericString(String(targetRate), 4);
  }
}

function syncClockSliderUi(container = document) {
  const minSlider = container.querySelector('[data-clock-slider="min"]');
  const minInput = container.querySelector('[data-setting="clockMin"]');
  const fill = container.querySelector(".dual-slider-fill");
  if (!minSlider || !minInput || !fill) return;
  const minValue = getClockSliderValue(state.settings.clockMin);
  minSlider.value = String(minValue);
  const left = ((minValue - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  fill.style.left = `${left}%`;
  fill.style.right = "0%";
}

function attachEvents() {
  const app = document.getElementById("app");
  const fileInput = document.getElementById("json-loader");

  app.querySelectorAll("[data-item-random]").forEach((button) => {
    button.onclick = () => {
      const row = state.itemRows.find((entry) => entry.id === button.dataset.itemRandom);
      if (!row) return;
      row.color = randomVisibleColor();
      ensureStateStructure();
      render();
    };
  });

  app.querySelectorAll("[data-item-picker]").forEach((button) => {
    button.onclick = () => openColorPicker(button.dataset.itemPicker, "color");
  });

  app.querySelectorAll("[data-item-field]").forEach((input) => {
    input.oninput = (event) => {
      const row = state.itemRows.find((entry) => entry.id === input.dataset.itemId);
      if (!row) return;
      row[input.dataset.itemField] = event.target.value;
    };
    input.onblur = () => {
      ensureStateStructure();
      render();
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    };
  });

  app.querySelectorAll("[data-belt-item]").forEach((input) => {
    input.onchange = (event) => {
      const row = state.itemRows.find((entry) => entry.id === input.dataset.beltItem);
      const belt = row?.belts.find((entry) => entry.id === input.dataset.beltId);
      if (!row || !belt) return;
      if (event.target.value === "__ONLY_OUTPUT__") {
        row.belts = [emptyBeltRow()];
        render();
        return;
      }
      belt.value = event.target.value;
      ensureTrailingBelts(row);
      render();
    };
  });

  app.querySelectorAll("[data-machine-field]").forEach((input) => {
    input.oninput = (event) => {
      const row = state.machineClassRows.find((entry) => entry.id === input.dataset.machineId);
      if (row) row[input.dataset.machineField] = event.target.value;
    };
    input.onblur = () => {
      const row = state.machineClassRows.find((entry) => entry.id === input.dataset.machineId);
      if (row && input.dataset.machineField === "power") row.power = normalizeNumericString(row.power, 4);
      if (row && input.dataset.machineField === "inputCounts") row.inputCounts = formatListNumbers(parseExactInputCounts(row.inputCounts));
      ensureStateStructure();
      render();
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    };
  });

  app.querySelectorAll("[data-edit-recipe]").forEach((button) => {
    button.onclick = () => openRecipeModal(button.dataset.editRecipe);
  });

  app.querySelectorAll("[data-belt-speed-field]").forEach((input) => {
    input.oninput = (event) => {
      const row = state.settings.beltSpeeds.find((entry) => entry.id === input.dataset.beltSpeedId);
      if (!row) return;
      row[input.dataset.beltSpeedField] = event.target.value;
    };
    input.onblur = () => {
      const row = state.settings.beltSpeeds.find((entry) => entry.id === input.dataset.beltSpeedId);
      if (!row) return;
      if (input.dataset.beltSpeedField === "speed") row.speed = normalizeNumericString(row.speed, 6);
      ensureStateStructure();
      render();
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    };
  });

  app.querySelectorAll("[data-action='add-recipe']").forEach((button) => {
    button.onclick = () => openRecipeModal();
  });

  app.querySelectorAll("[data-setting]").forEach((input) => {
    input.oninput = (event) => {
      state.settings[input.dataset.setting] = event.target.value;
    };
    input.onchange = (event) => {
      state.settings[input.dataset.setting] = event.target.value;
      if (input.tagName === "SELECT") render();
    };
    input.onblur = () => {
      commitSettings();
      sanitizeBeltSelections(state);
      render();
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    };
  });

  app.querySelectorAll("[data-setting-check]").forEach((input) => {
    input.onchange = (event) => {
      state.settings[input.dataset.settingCheck] = event.target.checked;
      render();
    };
  });

  app.querySelectorAll("[data-clock-slider]").forEach((input) => {
    input.step = String(CLOCK_STEP);
    input.onpointerdown = (event) => {
      if (typeof input.setPointerCapture === "function") input.setPointerCapture(event.pointerId);
    };
    input.oninput = (event) => {
      const value = getClockSliderValue(event.target.value);
      state.settings.clockMin = String(Math.min(value, 100));
      state.settings.clockMax = "100";
      syncClockSliderUi(app);
      const minInput = app.querySelector('[data-setting="clockMin"]');
      if (minInput) minInput.value = String(getClockSliderValue(state.settings.clockMin));
    };
    input.onpointerup = () => render();
    input.onpointercancel = () => render();
    input.onchange = () => render();
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

  app.querySelectorAll("[data-action='load-json']").forEach((button) => {
    button.onclick = () => fileInput.click();
  });

  if (fileInput) {
    fileInput.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        state = sanitizeState(JSON.parse(text));
        closeRecipeModal();
        closeColorPicker();
        render();
      } catch (error) {
        alert("Invalid JSON file.");
      } finally {
        fileInput.value = "";
      }
    };
  }

  app.querySelectorAll("[data-action='reset-all']").forEach((button) => {
    button.onclick = () => {
      state = createDefaultState();
      closeRecipeModal();
      closeColorPicker();
      render();
    };
  });

  syncClockSliderUi(app);
}

bindGlobalEvents();
bindFactoryTooltipEvents();
render();
