const STORAGE_KEY = "flowforge-state-v2";
const CLOCK_SLIDER_MIN = 0.01;
const CLOCK_SLIDER_MAX = 250;
const CLOCK_STEP = 1;

const uid = (() => {
  let i = 1;
  return (prefix) => `${prefix}-${i++}`;
})();

const colorContextCanvas = document.createElement("canvas").getContext("2d");

function emptyBeltRow() {
  return { id: uid("belt"), value: "" };
}

function emptyItemRow() {
  return { id: uid("item"), name: "", color: "", belts: [emptyBeltRow()] };
}

function emptyMachineClassRow() {
  return { id: uid("machine"), name: "", power: "" };
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

function createDefaultState() {
  return {
    itemRows: [emptyItemRow()],
    machineClassRows: [emptyMachineClassRow()],
    recipes: [],
    settings: {
      beltSpeeds: "60, 120, 270, 480, 780",
      splitterSizes: "2, 3",
      mergerSizes: "2, 3",
      maxPower: "1000",
      clockMin: "1",
      clockMax: "250",
      enableOverflow: true,
      targetOutputItemId: "",
      targetOutputRate: "60"
    }
  };
}

function sanitizeState(input) {
  const base = createDefaultState();
  const next = {
    itemRows: Array.isArray(input.itemRows) ? input.itemRows : base.itemRows,
    machineClassRows: Array.isArray(input.machineClassRows) ? input.machineClassRows : base.machineClassRows,
    recipes: Array.isArray(input.recipes) ? input.recipes : base.recipes,
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

  next.machineClassRows = next.machineClassRows.map((row) => ({
    id: row.id || uid("machine"),
    name: String(row.name || ""),
    power: String(row.power ?? "")
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

function formatListNumbers(values) {
  return values.map((value) => String(value)).join(", ");
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

function getClockSliderValue(value) {
  const parsed = parseNumber(String(value));
  if (parsed === null) return Math.round(CLOCK_SLIDER_MIN);
  return Math.max(Math.round(CLOCK_SLIDER_MIN), Math.min(Math.round(parsed), Math.round(CLOCK_SLIDER_MAX)));
}

function getSettingsNumbers(targetState = state) {
  const beltSpeeds = parseListNumbers(targetState.settings.beltSpeeds, false);
  const splitterSizes = parseListNumbers(targetState.settings.splitterSizes, true);
  const mergerSizes = parseListNumbers(targetState.settings.mergerSizes, true);
  const maxPower = parseNumber(targetState.settings.maxPower) ?? 0;
  const minClock = Math.max(CLOCK_SLIDER_MIN, Math.min(parseNumber(targetState.settings.clockMin) ?? 1, CLOCK_SLIDER_MAX));
  const maxClock = Math.max(minClock, Math.min(parseNumber(targetState.settings.clockMax) ?? 250, CLOCK_SLIDER_MAX));
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
  const meaningfulRows = targetState.machineClassRows.filter((row) => row.name.trim() || row.power.trim());
  const nameCounts = new Map();
  meaningfulRows.forEach((row) => {
    const key = row.name.trim().toLowerCase();
    if (key) nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  const statuses = new Map();
  targetState.machineClassRows.forEach((row) => {
    const key = row.name.trim().toLowerCase();
    const power = parseNumber(row.power);
    statuses.set(row.id, {
      empty: !row.name.trim() && !row.power.trim(),
      valid: Boolean(key && nameCounts.get(key) === 1 && power !== null && power > 0)
    });
  });
  return statuses;
}

function ensureMachineClassRows(targetState = state) {
  const meaningfulRows = targetState.machineClassRows.filter((row) => row.name.trim() || row.power.trim());
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

function sanitizeBeltSelections(targetState = state) {
  const validBeltValues = new Set(parseListNumbers(targetState.settings.beltSpeeds, false).map((value) => String(value)));
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
    .map((row) => ({ id: row.id, name: row.name.trim(), power: parseNumber(row.power) || 0 }));
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
  const filledInputs = next.inputs.filter((row) => row.itemId || row.qty !== "");
  next.inputs = filledInputs.length ? filledInputs : [emptyRecipeInputRow()];
  ensureDraftInputRows(next);
  return next;
}

function isDraftInputRowValid(row) {
  const qty = parseNumber(row.qty);
  return Boolean(row.itemId && qty !== null && qty > 0);
}

function ensureDraftInputRows(draft) {
  const meaningful = draft.inputs.filter((row) => row.itemId || row.qty !== "");
  if (!meaningful.length) {
    draft.inputs = [emptyRecipeInputRow()];
    return;
  }
  draft.inputs = meaningful;
  if (isDraftInputRowValid(meaningful[meaningful.length - 1])) draft.inputs.push(emptyRecipeInputRow());
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
  const validInputs = draft.inputs
    .map((row) => ({ ...row, qtyNum: parseNumber(row.qty) }))
    .filter((row) => row.itemId && itemMap.has(row.itemId) && row.qtyNum !== null && row.qtyNum > 0);
  const outputQty = parseNumber(draft.outputQty);
  const itemsPerMinute = parseNumber(draft.itemsPerMinute);
  const valid =
    validInputs.length > 0 &&
    duplicateInputIds.size === 0 &&
    draft.outputItemId &&
    itemMap.has(draft.outputItemId) &&
    outputQty !== null &&
    outputQty > 0 &&
    draft.machineClassId &&
    machineMap.has(draft.machineClassId) &&
    itemsPerMinute !== null &&
    itemsPerMinute > 0;
  return { valid, validInputs, duplicateInputIds };
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
  candidates.forEach((recipe) => {
    const machine = machineMap.get(recipe.machineClassId);
    const outputQty = parseNumber(recipe.outputQty);
    const baseRate = parseNumber(recipe.itemsPerMinute);
    if (!machine || outputQty === null || outputQty <= 0 || baseRate === null || baseRate <= 0) return;

    let machineCount = Math.max(1, Math.ceil(requiredRate / (baseRate * settings.maxClock / 100)));
    let clock = ceilTwoDecimals(requiredRate / (baseRate * machineCount) * 100);
    while (clock > settings.maxClock) {
      machineCount += 1;
      clock = ceilTwoDecimals(requiredRate / (baseRate * machineCount) * 100);
    }

    let actualRate = requiredRate;
    let overflowRate = 0;
    if (clock < settings.minClock) {
      if (!settings.enableOverflow) return;
      clock = settings.minClock;
      actualRate = baseRate * machineCount * (clock / 100);
      overflowRate = Math.max(0, actualRate - requiredRate);
    } else {
      actualRate = baseRate * machineCount * (clock / 100);
      overflowRate = Math.max(0, actualRate - requiredRate);
    }

    const powerUse = machineCount * machine.power * (clock / 100);
    const score = powerUse * 1000 + machineCount * 10 + overflowRate;
    const candidate = { recipe, machine, outputQty, baseRate, machineCount, clock, actualRate, overflowRate, powerUse, score };
    if (!best || candidate.score < best.score) best = candidate;
  });
  return best;
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
  let nextOverflowBelt = 1;

  function solveItem(itemId, requiredRate, trail = []) {
    if (trail.includes(itemId)) return { ok: false, error: `Cycle detected involving ${roleState.itemMap.get(itemId)?.name || "Unknown"}.` };
    const item = roleState.itemMap.get(itemId);
    if (!item) return { ok: false, error: "Unknown item in solver." };

    if (roleState.externalInputIds.has(itemId)) {
      const node = { type: "external", itemId, label: item.name, rate: requiredRate, children: [] };
      externalDemand.set(itemId, (externalDemand.get(itemId) || 0) + requiredRate);
      return { ok: true, node, power: 0 };
    }

    const candidates = recipeByOutput.get(itemId) || [];
    const chosen = chooseRecipeCandidate(candidates, requiredRate, settings, machineMap);
    if (!chosen) return { ok: false, error: `${item.name} is not externally supplied and no valid recipe can produce it.` };

    const inputNodes = [];
    for (const row of chosen.recipe.inputs) {
      const qty = parseNumber(row.qty);
      if (!row.itemId || qty === null || qty <= 0) continue;
      const neededRate = chosen.actualRate * qty / chosen.outputQty;
      const inputResult = solveItem(row.itemId, neededRate, [...trail, itemId]);
      if (!inputResult.ok) return inputResult;
      inputNodes.push(inputResult.node);
    }

    if (chosen.overflowRate > 0) {
      const beltId = nextOverflowBelt++;
      overflowBelts.push({ id: beltId, itemId, itemName: item.name, rate: chosen.overflowRate, recipeId: chosen.recipe.id });
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
    plan.actualRate += chosen.actualRate;
    plan.machineCount += chosen.machineCount;
    plan.powerUse += chosen.powerUse;
    plan.clock = Math.max(plan.clock, chosen.clock);

    return {
      ok: true,
      power: chosen.powerUse + inputNodes.reduce((sum, node) => sum + (node.powerUse || 0), 0),
      node: {
        type: "recipe",
        recipeId: chosen.recipe.id,
        outputItemId: itemId,
        label: item.name,
        machineName: chosen.machine.name,
        requiredRate,
        actualRate: chosen.actualRate,
        overflowRate: chosen.overflowRate,
        children: inputNodes,
        powerUse: chosen.powerUse
      }
    };
  }

  const targetResult = solveItem(settings.targetOutputItemId, targetRate, []);
  if (!targetResult.ok) errors.push(targetResult.error);

  externalDemand.forEach((demand, itemId) => {
    const available = roleState.externalRates.get(itemId) || 0;
    if (demand > available) {
      errors.push(`${roleState.itemMap.get(itemId)?.name || "Unknown"} requires ${fmt(demand)} item/min, but only ${fmt(available)} item/min is externally available.`);
    }
  });

  const machinePlans = [...planMap.values()];
  const totalPower = machinePlans.reduce((sum, plan) => sum + plan.powerUse, 0);
  if (totalPower > settings.maxPower) warnings.push(`Power limit exceeded by ${fmt(totalPower - settings.maxPower)} MW.`);
  if (duplicates.size) warnings.push("Duplicate recipes detected. Only the first instance of each duplicate set is used by the solver.");

  return {
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
    reachable: errors.length === 0 && Boolean(targetResult.ok),
    targetNode: targetResult.ok ? targetResult.node : null
  };
}

function treeDepth(node) {
  if (!node) return 0;
  if (!node.children?.length) return 1;
  return 1 + Math.max(...node.children.map(treeDepth));
}

function assignTreePositions(node, depth = 0, positions = [], cursor = { y: 80 }) {
  if (!node) return positions;
  const children = node.children || [];
  if (!children.length) {
    const y = cursor.y;
    cursor.y += 120;
    positions.push({ node, depth, x: 100 + depth * 260, y });
    return positions;
  }
  const childPositions = [];
  children.forEach((child) => assignTreePositions(child, depth + 1, childPositions, cursor));
  const y = childPositions.reduce((sum, entry) => sum + entry.y, 0) / childPositions.length;
  positions.push({ node, depth, x: 100 + depth * 260, y });
  childPositions.forEach((entry) => positions.push(entry));
  return positions;
}

function renderSolverBoard(solution) {
  if (!solution.targetNode) {
    return `
      <svg viewBox="0 0 1200 480" role="img" aria-label="Solver board">
        <text x="600" y="200" text-anchor="middle" class="board-placeholder">No solved production chain yet</text>
        <text x="600" y="230" text-anchor="middle" class="board-placeholder-sub">Define machine classes and recipes, then choose a target output.</text>
      </svg>
    `;
  }

  const positions = assignTreePositions(solution.targetNode);
  const deduped = [];
  const seen = new Set();
  positions.forEach((entry) => {
    const key = `${entry.node.type}:${entry.node.recipeId || entry.node.itemId}:${entry.depth}:${Math.round(entry.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });

  const width = Math.max(1200, (treeDepth(solution.targetNode) + 1) * 270 + 180);
  const height = Math.max(480, deduped.reduce((max, entry) => Math.max(max, entry.y), 120) + 120);
  const nodeWidth = 190;
  const nodeHeight = 70;

  let svg = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Solver board">
      <defs>
        <marker id="solver-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L10,4 L0,8 z" fill="#4b4234"></path>
        </marker>
      </defs>
  `;

  deduped.forEach((entry) => {
    (entry.node.children || []).forEach((child) => {
      const childEntry = deduped.find((candidate) => candidate.node === child);
      if (!childEntry) return;
      svg += `<path d="M ${childEntry.x + nodeWidth} ${childEntry.y} L ${entry.x} ${entry.y}" fill="none" stroke="#5d533f" stroke-width="2.2" marker-end="url(#solver-arrow)"></path>`;
    });
  });

  deduped.forEach((entry) => {
    const isExternal = entry.node.type === "external";
    svg += `
      <g class="graph-node">
        <rect x="${entry.x}" y="${entry.y - nodeHeight / 2}" width="${nodeWidth}" height="${nodeHeight}" fill="${isExternal ? "rgba(245,235,210,0.92)" : "rgba(255,255,255,0.92)"}"></rect>
        <text x="${entry.x + 16}" y="${entry.y - 10}" class="graph-label">${escapeHtml(entry.node.label)}</text>
        <text x="${entry.x + 16}" y="${entry.y + 10}" class="graph-sub">${escapeHtml(isExternal ? "External input" : entry.node.machineName)}</text>
        <text x="${entry.x + 16}" y="${entry.y + 28}" class="graph-sub">${escapeHtml(`${fmt(entry.node.actualRate || entry.node.rate)} item/min`)}</text>
      </g>
    `;
  });

  return `${svg}</svg>`;
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
      </div>
      <div class="modal-section modal-two-col">
        <div>
          <label class="field-label">Output item</label>
          <select data-recipe-draft="outputItemId">
            <option value="">Select output item</option>
            ${outputSelectableItems.map((item) => `<option value="${item.id}" ${item.id === draft.outputItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Output quantity per craft</label>
          <input type="text" value="${escapeHtml(draft.outputQty)}" data-recipe-draft="outputQty">
        </div>
      </div>
      <div class="modal-section modal-two-col">
        <div>
          <label class="field-label">Machine class</label>
          <select data-recipe-draft="machineClassId">
            <option value="">Select machine class</option>
            ${machineClasses.map((machine) => `<option value="${machine.id}" ${machine.id === draft.machineClassId ? "selected" : ""}>${escapeHtml(machine.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Items per minute</label>
          <input type="text" value="${escapeHtml(draft.itemsPerMinute)}" data-recipe-draft="itemsPerMinute">
        </div>
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
  ensureDraftInputRows(draft);
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
        ensureDraftInputRows(recipeModalState.draft);
        renderRecipeModal();
        return;
      }
      if (field === "outputItemId" || field === "machineClassId") {
        recipeModalState.draft[field] = event.target.value;
        syncRecipeModalUi();
      }
    };
    element.onblur = () => {
      const field = element.dataset.recipeDraft;
      commitRecipeDraftField(field, element.dataset.rowId);
      renderRecipeModal();
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
  const items = getDefinedItems();
  const machineClasses = getDefinedMachineClasses();
  const roleState = deriveItemRoles();
  const itemStatuses = getItemRowStatuses();
  const machineStatuses = getMachineClassStatuses();
  const duplicateRecipes = solution.duplicateIds;
  const beltSpeedOptions = getSettingsNumbers().beltSpeeds.map((speed) => String(speed));
  const targetItems = items.filter((item) => !roleState.externalInputIds.has(item.id));
  const clockMin = getClockSliderValue(state.settings.clockMin || 1);
  const clockMax = Math.max(clockMin, getClockSliderValue(state.settings.clockMax || 250));
  const sliderLeft = ((clockMin - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const sliderRight = ((clockMax - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;

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
            <div><label class="field-label">Available belt speeds</label><input type="text" value="${escapeHtml(state.settings.beltSpeeds)}" data-setting="beltSpeeds"></div>
            <div><label class="field-label">Allowed splitter sizes</label><input type="text" value="${escapeHtml(state.settings.splitterSizes)}" data-setting="splitterSizes"></div>
            <div><label class="field-label">Allowed merger sizes</label><input type="text" value="${escapeHtml(state.settings.mergerSizes)}" data-setting="mergerSizes"></div>
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
            <div class="clock-panel">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <strong>Clock speed interval</strong>
                <span class="pill">${fmt(getSettingsNumbers().minClock)}% to ${fmt(getSettingsNumbers().maxClock)}%</span>
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
              <div class="row cols-2">
                <div>
                  <label class="field-label">Machine name</label>
                  <input type="text" value="${escapeHtml(row.name)}" data-machine-field="name" data-machine-id="${row.id}">
                </div>
                <div>
                  <label class="field-label">Power usage at 100%</label>
                  <input type="text" value="${escapeHtml(row.power)}" data-machine-field="power" data-machine-id="${row.id}">
                </div>
              </div>
              <div class="footnote">
                ${machineStatuses.get(row.id)?.valid
                  ? `Registered as <strong>${escapeHtml(row.name.trim())}</strong>.`
                  : index === state.machineClassRows.length - 1
                    ? "Leave one empty row available for the next machine class."
                    : "Machine class names must be unique and power must be numeric."}
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
      </div>
    </div>

    <section class="board-shell">
      <div class="board-header">
        <div>
          <strong>Solver Board</strong>
          <div class="footnote">Automatically derived dependency chain for the current target output.</div>
        </div>
      </div>
      <div class="board-stage">${renderSolverBoard(solution)}</div>
    </section>
  `;

  attachEvents();
  renderColorPicker();
  renderRecipeModal();
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
    const targetRate = parseNumber(state.settings.targetOutputRate);
    state.settings.targetOutputRate = targetRate === null ? "" : normalizeNumericString(String(targetRate), 4);
  }
}

function syncClockSliderUi(container = document) {
  const minSlider = container.querySelector('[data-clock-slider="min"]');
  const maxSlider = container.querySelector('[data-clock-slider="max"]');
  const minInput = container.querySelector('[data-setting="clockMin"]');
  const maxInput = container.querySelector('[data-setting="clockMax"]');
  const fill = container.querySelector(".dual-slider-fill");
  if (!minSlider || !maxSlider || !minInput || !maxInput || !fill) return;
  const minValue = getClockSliderValue(state.settings.clockMin);
  const maxValue = Math.max(minValue, getClockSliderValue(state.settings.clockMax));
  minSlider.value = String(minValue);
  maxSlider.value = String(maxValue);
  const left = ((minValue - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  const right = ((maxValue - CLOCK_SLIDER_MIN) / (CLOCK_SLIDER_MAX - CLOCK_SLIDER_MIN)) * 100;
  fill.style.left = `${left}%`;
  fill.style.right = `${100 - right}%`;
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
      const currentMin = getClockSliderValue(state.settings.clockMin);
      const currentMax = getClockSliderValue(state.settings.clockMax);
      if (event.target.dataset.clockSlider === "min") state.settings.clockMin = String(Math.min(value, currentMax));
      else state.settings.clockMax = String(Math.max(value, currentMin));
      syncClockSliderUi(app);
      const minInput = app.querySelector('[data-setting="clockMin"]');
      const maxInput = app.querySelector('[data-setting="clockMax"]');
      if (minInput) minInput.value = String(getClockSliderValue(state.settings.clockMin));
      if (maxInput) maxInput.value = String(getClockSliderValue(state.settings.clockMax));
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
render();
