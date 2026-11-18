"use strict";

const HISTORY_STORAGE_KEY = "structured-formatter.history.v1";
const HISTORY_LIMIT = 20;
const TREE_PANEL_MIN_WIDTH = 240;
const OUTPUT_PANEL_MIN_WIDTH = 480;
const PANEL_GAP = 12;
const historyTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const elements = {
  workspace: document.querySelector(".workspace"),
  inputPanel: document.querySelector(".input-panel"),
  treePanel: document.querySelector(".tree-panel"),
  outputPanel: document.querySelector(".output-panel"),
  columnResizer: document.getElementById("columnResizer"),
  source: document.getElementById("sourceInput"),
  inputSize: document.getElementById("inputSize"),
  format: document.getElementById("formatButton"),
  clear: document.getElementById("clearButton"),
  error: document.getElementById("errorMessage"),
  treeView: document.getElementById("treeView"),
  treeRoot: document.getElementById("treeRoot"),
  treeEmpty: document.getElementById("treeEmpty"),
  nodeCount: document.getElementById("nodeCount"),
  expandAll: document.getElementById("expandAllButton"),
  collapseAll: document.getElementById("collapseAllButton"),
  type: document.getElementById("documentType"),
  lineCount: document.getElementById("lineCount"),
  search: document.getElementById("searchInput"),
  matchCount: document.getElementById("matchCount"),
  previousMatch: document.getElementById("previousMatchButton"),
  nextMatch: document.getElementById("nextMatchButton"),
  copy: document.getElementById("copyButton"),
  outputEmpty: document.getElementById("outputEmpty"),
  output: document.getElementById("formattedOutput"),
  outputCode: document.getElementById("outputCode"),
  statusDot: document.getElementById("statusDot"),
  status: document.getElementById("statusMessage"),
  toast: document.getElementById("toast"),
  historyButton: document.getElementById("historyButton"),
  historyDialog: document.getElementById("historyDialog"),
  closeHistory: document.getElementById("closeHistoryButton"),
  cancelHistory: document.getElementById("cancelHistoryButton"),
  loadHistory: document.getElementById("loadHistoryButton"),
  historyList: document.getElementById("historyList"),
  historyEmpty: document.getElementById("historyEmpty"),
  historySummary: document.getElementById("historySummary")
};

const state = {
  result: null,
  treeRoot: null,
  nodes: new Map(),
  matches: [],
  activeMatch: -1,
  selectedNode: null,
  toastTimer: null,
  history: [],
  selectedHistoryId: null
};

let nextNodeId = 0;
let columnDrag = null;

elements.source.addEventListener("input", () => {
  updateInputSize();
  hideError();
  if (state.result) {
    setStatus("原始文本已修改，点击格式化以更新文档树和结果");
  }
});

elements.format.addEventListener("click", formatSource);
elements.clear.addEventListener("click", clearWorkspace);
elements.expandAll.addEventListener("click", () => setAllNodesExpanded(true));
elements.collapseAll.addEventListener("click", () => setAllNodesExpanded(false));
elements.search.addEventListener("input", updateSearch);
elements.previousMatch.addEventListener("click", () => navigateMatch(-1));
elements.nextMatch.addEventListener("click", () => navigateMatch(1));
elements.copy.addEventListener("click", copyFormattedDocument);
elements.historyButton.addEventListener("click", openHistory);
elements.closeHistory.addEventListener("click", () => elements.historyDialog.close());
elements.cancelHistory.addEventListener("click", () => elements.historyDialog.close());
elements.loadHistory.addEventListener("click", loadSelectedHistory);
elements.historyList.addEventListener("change", (event) => {
  if (event.target.name !== "historyRecord") return;
  state.selectedHistoryId = event.target.value;
  elements.loadHistory.disabled = false;
});
elements.historyDialog.addEventListener("click", (event) => {
  if (event.target !== elements.historyDialog) return;
  const rect = elements.historyDialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) elements.historyDialog.close();
});

elements.columnResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  columnDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: elements.treePanel.getBoundingClientRect().width
  };
  elements.columnResizer.focus({ preventScroll: true });
  elements.columnResizer.setPointerCapture(event.pointerId);
  elements.columnResizer.classList.add("is-dragging");
  document.body.classList.add("is-resizing-columns");
  event.preventDefault();
});

elements.columnResizer.addEventListener("pointermove", (event) => {
  if (!columnDrag || event.pointerId !== columnDrag.pointerId) return;
  setTreePanelWidth(columnDrag.startWidth + event.clientX - columnDrag.startX);
});

elements.columnResizer.addEventListener("pointerup", finishColumnResize);
elements.columnResizer.addEventListener("pointercancel", finishColumnResize);
elements.columnResizer.addEventListener("lostpointercapture", finishColumnResize);
elements.columnResizer.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const step = event.shiftKey ? 48 : 16;
  const width = elements.treePanel.getBoundingClientRect().width;
  setTreePanelWidth(width + direction * step);
});

window.addEventListener("resize", updateColumnResizer);

elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    navigateMatch(event.shiftKey ? -1 : 1);
  }
});

elements.treeRoot.addEventListener("click", (event) => {
  const button = event.target.closest(".tree-node");
  if (!button) return;
  const node = state.nodes.get(button.dataset.nodeId);
  if (!node) return;

  if (state.selectedNode) {
    state.selectedNode.classList.remove("is-selected");
  }
  state.selectedNode = button;
  button.classList.add("is-selected");

  if (node.children.length) {
    setNodeExpanded(button, node, !node.expanded);
  }
  copyTreeNode(node);
});

document.addEventListener("keydown", (event) => {
  if (elements.historyDialog.open) return;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    formatSource();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && state.result) {
    event.preventDefault();
    elements.search.focus();
    elements.search.select();
  }
});

function formatSource() {
  hideError();
  try {
    const result = StructuredParser.parseDocument(elements.source.value);
    state.result = result;
    renderTree(result);
    renderOutput();
    setStatus(buildSuccessMessage(result), "success");
    saveHistory(result);
    return true;
  } catch (error) {
    resetResult();
    if (error instanceof StructuredParser.DocumentError) {
      showError(error.message, error.details);
      setStatus(error.message, "error");
    } else {
      showError("解析时发生错误，请检查输入内容后重试。", error.message);
      setStatus("解析失败，请检查输入内容", "error");
    }
    return false;
  }
}

function clearWorkspace() {
  elements.source.value = "";
  state.result = null;
  updateInputSize();
  hideError();
  resetResult();
  setStatus("已清空，所有解析均在本地完成");
  elements.source.focus();
}

function resetResult() {
  state.result = null;
  state.treeRoot = null;
  state.nodes.clear();
  state.matches = [];
  state.activeMatch = -1;
  state.selectedNode = null;

  elements.treeRoot.replaceChildren();
  elements.treeRoot.hidden = true;
  elements.treeEmpty.hidden = false;
  elements.nodeCount.textContent = "";
  elements.expandAll.disabled = true;
  elements.collapseAll.disabled = true;

  elements.outputCode.replaceChildren();
  elements.output.hidden = true;
  elements.outputEmpty.hidden = false;
  elements.type.hidden = true;
  elements.lineCount.textContent = "";
  elements.copy.disabled = true;

  elements.search.value = "";
  elements.search.disabled = true;
  elements.matchCount.textContent = "";
  elements.previousMatch.disabled = true;
  elements.nextMatch.disabled = true;
}

function updateInputSize() {
  elements.inputSize.textContent = `${new Intl.NumberFormat("zh-CN").format(elements.source.value.length)} 字符`;
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.title = message;
  elements.statusDot.className = `status-dot${type ? ` is-${type}` : ""}`;
}

function buildSuccessMessage(result) {
  const ignored = result.ignoredBefore + result.ignoredAfter;
  const extraction = ignored ? `，已过滤文档外 ${ignored} 个字符` : "";
  return `${result.type.toUpperCase()} 格式化完成${extraction}，文档树共 ${state.nodes.size} 个节点`;
}

function showError(message, details = "") {
  elements.error.textContent = details ? `${message}\n${details}` : message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function updateColumnResizer() {
  const treeWidth = elements.treePanel.getBoundingClientRect().width;
  elements.columnResizer.setAttribute("aria-valuenow", String(Math.round(treeWidth)));
  elements.columnResizer.setAttribute("aria-valuemax", String(Math.round(getMaximumTreeWidth())));
}

function getMaximumTreeWidth() {
  const style = getComputedStyle(elements.workspace);
  const contentWidth = elements.workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const inputWidth = elements.inputPanel.getBoundingClientRect().width;
  return Math.max(TREE_PANEL_MIN_WIDTH, contentWidth - inputWidth - PANEL_GAP * 2 - OUTPUT_PANEL_MIN_WIDTH);
}

function setTreePanelWidth(width) {
  const inputWidth = elements.inputPanel.getBoundingClientRect().width;
  const treeWidth = elements.treePanel.getBoundingClientRect().width;
  const outputWidth = elements.outputPanel.getBoundingClientRect().width;
  const nextWidth = Math.min(getMaximumTreeWidth(), Math.max(TREE_PANEL_MIN_WIDTH, width));
  const nextOutputWidth = treeWidth + outputWidth - nextWidth;
  elements.workspace.style.gridTemplateColumns = `minmax(${TREE_PANEL_MIN_WIDTH}px, ${inputWidth}fr) ${PANEL_GAP}px minmax(${TREE_PANEL_MIN_WIDTH}px, ${nextWidth}fr) ${PANEL_GAP}px minmax(${OUTPUT_PANEL_MIN_WIDTH}px, ${nextOutputWidth}fr)`;
  updateColumnResizer();
}

function finishColumnResize(event) {
  if (!columnDrag || event.pointerId !== columnDrag.pointerId) return;
  const pointerId = columnDrag.pointerId;
  columnDrag = null;
  elements.columnResizer.classList.remove("is-dragging");
  document.body.classList.remove("is-resizing-columns");
  if (elements.columnResizer.hasPointerCapture(pointerId)) {
    elements.columnResizer.releasePointerCapture(pointerId);
  }
  updateColumnResizer();
}

function renderTree(result) {
  state.nodes.clear();
  nextNodeId = 0;
  state.treeRoot = result.type === "json"
    ? createJsonTreeNode(result.data, "$", 0)
    : createXmlTreeNode(result.document.documentElement, 0);

  elements.treeRoot.replaceChildren(renderTreeNode(state.treeRoot, 0));
  elements.treeRoot.hidden = false;
  elements.treeEmpty.hidden = true;
  elements.nodeCount.textContent = `${state.nodes.size} 节点`;
  elements.expandAll.disabled = !Array.from(state.nodes.values()).some((node) => node.children.length);
  elements.collapseAll.disabled = elements.expandAll.disabled;
}

function createJsonTreeNode(value, label, depth) {
  const node = createTreeNode(label, depth);
  if (value !== null && typeof value === "object") {
    node.copyText = JSON.stringify(value, null, 2);
  } else if (value === null) {
    node.copyText = "null";
  } else {
    node.copyText = typeof value === "string" ? value : String(value);
  }

  if (Array.isArray(value)) {
    node.kind = `数组 · ${value.length}`;
    node.preview = value.length ? "[ … ]" : "[ ]";
    node.children = value.map((item, index) => createJsonTreeNode(item, `[${index}]`, depth + 1));
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    node.kind = `对象 · ${entries.length}`;
    node.preview = entries.length ? "{ … }" : "{ }";
    node.children = entries.map(([key, item]) => createJsonTreeNode(item, key, depth + 1));
  } else {
    node.kind = value === null ? "null" : typeof value === "string" ? "字符串" : typeof value === "number" ? "数字" : "布尔值";
    node.preview = previewValue(JSON.stringify(value));
  }
  return node;
}

function createXmlTreeNode(xmlNode, depth) {
  if (xmlNode.nodeType !== 1) {
    const leaf = createTreeNode(xmlLeafLabel(xmlNode), depth);
    leaf.kind = xmlLeafKind(xmlNode);
    leaf.preview = previewValue(xmlNode.data || "");
    leaf.copyText = xmlNode.data || "";
    return leaf;
  }

  const node = createTreeNode(`<${xmlNode.nodeName}>`, depth);
  node.copyText = StructuredParser.formatXmlNode(xmlNode, 0);
  const attributes = Array.from(xmlNode.attributes || []);
  const children = Array.from(xmlNode.childNodes).filter(
    (child) => child.nodeType !== 3 || child.data.trim()
  );
  const elementCount = children.filter((child) => child.nodeType === 1).length;
  node.kind = `元素 · ${elementCount}`;
  node.preview = attributes.length ? `${attributes.length} 个属性` : "";
  node.children = [
    ...attributes.map((attribute) => {
      const attributeNode = createTreeNode(`@${attribute.name}`, depth + 1);
      attributeNode.kind = "属性";
      attributeNode.preview = previewValue(attribute.value);
      attributeNode.copyText = attribute.value;
      return attributeNode;
    }),
    ...children.map((child) => createXmlTreeNode(child, depth + 1))
  ];
  return node;
}

function createTreeNode(label, depth) {
  const node = {
    id: `node-${nextNodeId++}`,
    label,
    kind: "",
    preview: "",
    copyText: "",
    children: [],
    expanded: depth === 0
  };
  state.nodes.set(node.id, node);
  return node;
}

function xmlLeafLabel(node) {
  if (node.nodeType === 3) return "#text";
  if (node.nodeType === 4) return "#cdata";
  if (node.nodeType === 8) return "#comment";
  if (node.nodeType === 7) return `<?${node.target}?>`;
  return `#${node.nodeName}`;
}

function xmlLeafKind(node) {
  if (node.nodeType === 3) return "文本";
  if (node.nodeType === 4) return "CDATA";
  if (node.nodeType === 8) return "注释";
  if (node.nodeType === 7) return "处理指令";
  return "节点";
}

function previewValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function renderTreeNode(node, depth) {
  const item = document.createElement("li");
  item.setAttribute("role", "treeitem");

  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-node${node.children.length ? "" : " is-leaf"}`;
  button.dataset.nodeId = node.id;
  button.style.setProperty("--depth", depth);
  button.setAttribute("aria-label", `${node.label} ${node.kind} ${node.preview}`.trim());
  button.title = node.children.length ? "点击复制节点内容，并展开或收起" : "点击复制节点内容";
  if (node.children.length) {
    button.setAttribute("aria-expanded", String(node.expanded));
  }

  const chevron = document.createElement("span");
  chevron.className = "tree-chevron";
  chevron.setAttribute("aria-hidden", "true");
  button.append(chevron);

  const key = document.createElement("span");
  key.className = "tree-key";
  key.textContent = node.label;
  button.append(key);

  if (node.kind) {
    const kind = document.createElement("span");
    kind.className = "tree-kind";
    kind.textContent = node.kind;
    button.append(kind);
  }

  if (node.preview) {
    const preview = document.createElement("span");
    preview.className = "tree-preview";
    preview.textContent = node.preview;
    preview.title = node.preview;
    button.append(preview);
  }

  item.append(button);
  if (node.children.length) {
    const children = document.createElement("ul");
    children.className = "tree-children";
    children.setAttribute("role", "group");
    children.hidden = !node.expanded;
    for (const child of node.children) {
      children.append(renderTreeNode(child, depth + 1));
    }
    item.append(children);
  }
  return item;
}

function setNodeExpanded(button, node, expanded) {
  node.expanded = expanded;
  button.setAttribute("aria-expanded", String(expanded));
  const children = button.parentElement.querySelector(":scope > .tree-children");
  if (children) children.hidden = !expanded;
}

function setAllNodesExpanded(expanded) {
  for (const [id, node] of state.nodes) {
    if (!node.children.length) continue;
    node.expanded = expanded;
    const button = elements.treeRoot.querySelector(`[data-node-id="${id}"]`);
    if (button) setNodeExpanded(button, node, expanded);
  }
}

function renderOutput() {
  const formatted = state.result.formatted;
  elements.outputEmpty.hidden = true;
  elements.output.hidden = false;
  elements.type.textContent = state.result.type.toUpperCase();
  elements.type.hidden = false;
  elements.lineCount.textContent = `${new Intl.NumberFormat("zh-CN").format(formatted.split("\n").length)} 行`;
  elements.copy.disabled = false;
  elements.search.disabled = false;
  updateSearch();
  elements.output.scrollTop = 0;
  elements.output.scrollLeft = 0;
}

function updateSearch() {
  if (!state.result) return;
  const query = elements.search.value;
  const formatted = state.result.formatted;
  state.matches = findMatches(formatted, query);
  state.activeMatch = state.matches.length ? 0 : -1;
  renderFormattedText(formatted, query, state.matches);
  updateMatchControls();
  if (state.activeMatch >= 0) activateMatch(0, false);
}

function findMatches(text, query) {
  if (!query) return [];
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const matches = [];
  let index = normalizedText.indexOf(normalizedQuery);
  while (index !== -1) {
    matches.push({ start: index, end: index + query.length });
    index = normalizedText.indexOf(normalizedQuery, index + query.length);
  }
  return matches;
}

function renderFormattedText(text, query, matches) {
  const fragment = document.createDocumentFragment();
  if (!query || !matches.length) {
    fragment.append(document.createTextNode(text));
  } else {
    let cursor = 0;
    matches.forEach((match, index) => {
      fragment.append(document.createTextNode(text.slice(cursor, match.start)));
      const mark = document.createElement("mark");
      mark.dataset.matchIndex = String(index);
      mark.textContent = text.slice(match.start, match.end);
      fragment.append(mark);
      cursor = match.end;
    });
    fragment.append(document.createTextNode(text.slice(cursor)));
  }
  elements.outputCode.replaceChildren(fragment);
}

function updateMatchControls() {
  const query = elements.search.value;
  const count = state.matches.length;
  elements.matchCount.textContent = query ? (count ? `${state.activeMatch + 1} / ${count}` : "0 / 0") : "";
  elements.previousMatch.disabled = !count;
  elements.nextMatch.disabled = !count;
}

function navigateMatch(direction) {
  if (!state.matches.length) return;
  const next = (state.activeMatch + direction + state.matches.length) % state.matches.length;
  activateMatch(next, true);
}

function activateMatch(index, smooth) {
  const previous = elements.outputCode.querySelector("mark.is-active");
  if (previous) previous.classList.remove("is-active");
  const current = elements.outputCode.querySelector(`mark[data-match-index="${index}"]`);
  if (!current) return;

  state.activeMatch = index;
  current.classList.add("is-active");
  updateMatchControls();
  current.scrollIntoView({ block: "center", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
}

function openHistory() {
  state.history = readHistory();
  state.selectedHistoryId = null;
  elements.loadHistory.disabled = true;
  renderHistory();
  if (!elements.historyDialog.open) {
    elements.historyDialog.showModal();
  }
}

function renderHistory() {
  elements.historyList.replaceChildren();
  elements.historyEmpty.hidden = state.history.length > 0;
  elements.historyList.hidden = state.history.length === 0;
  elements.historySummary.textContent = state.history.length
    ? `已保存 ${state.history.length} / ${HISTORY_LIMIT} 条记录`
    : "最多保留 20 条记录";

  for (const record of state.history) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    label.className = "history-record";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "historyRecord";
    radio.value = record.id;

    const main = document.createElement("span");
    main.className = "history-record-main";
    const top = document.createElement("span");
    top.className = "history-record-top";
    const type = document.createElement("span");
    type.className = "type-badge";
    type.textContent = record.type.toUpperCase();
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = historyTimeFormatter.format(new Date(record.createdAt));
    top.append(type, time);

    const preview = document.createElement("span");
    preview.className = "history-preview";
    preview.textContent = record.preview;
    preview.title = record.preview;
    main.append(top, preview);

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${new Intl.NumberFormat("zh-CN").format(record.source.length)} 字符`;

    label.append(radio, main, meta);
    item.append(label);
    elements.historyList.append(item);
  }
}

function loadSelectedHistory() {
  const record = state.history.find((item) => item.id === state.selectedHistoryId);
  if (!record) return;

  elements.source.value = record.source;
  updateInputSize();
  elements.historyDialog.close();
  if (formatSource()) {
    showToast("已加载所选解析记录");
  }
}

function readHistory() {
  try {
    const records = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(records)) return [];
    return records
      .filter((record) => record && typeof record.id === "string" && typeof record.source === "string"
        && ["json", "xml"].includes(record.type) && Number.isFinite(record.createdAt))
      .map((record) => ({
        id: record.id,
        source: record.source,
        type: record.type,
        createdAt: record.createdAt,
        preview: typeof record.preview === "string" ? record.preview : record.source.replace(/\s+/g, " ").trim().slice(0, 180)
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT);
  } catch (_) {
    return [];
  }
}

function saveHistory(result) {
  const source = elements.source.value;
  const record = {
    id: crypto.randomUUID(),
    source,
    type: result.type,
    createdAt: Date.now(),
    preview: result.text.replace(/\s+/g, " ").trim().slice(0, 180)
  };
  let records = [record, ...readHistory().filter((item) => item.source !== source)].slice(0, HISTORY_LIMIT);

  while (records.length) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
      state.history = records;
      return;
    } catch (_) {
      records = records.slice(0, -1);
    }
  }
  showToast("格式化成功，但历史记录未能保存");
}

async function copyTreeNode(node) {
  if (await writeClipboard(node.copyText)) {
    showToast("节点内容已复制");
  } else {
    showToast("复制失败，请重试");
  }
}

async function copyFormattedDocument() {
  if (!state.result) return;
  if (await writeClipboard(state.result.formatted)) {
    showToast("格式化文档已复制");
  } else {
    showToast("复制失败，请在结果区域全选后复制");
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    return copied;
  }
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2200);
}

const columnResizeObserver = new ResizeObserver(updateColumnResizer);
columnResizeObserver.observe(elements.workspace);

updateInputSize();
updateColumnResizer();
