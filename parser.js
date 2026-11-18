(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.StructuredParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class DocumentError extends Error {
    constructor(code, message, details = "") {
      super(message);
      this.name = "DocumentError";
      this.code = code;
      this.details = details;
    }
  }

  function parseDocument(input) {
    const source = String(input ?? "");
    if (!source.trim()) {
      throw new DocumentError("EMPTY_INPUT", "请先粘贴需要格式化的 JSON 或 XML 文本。");
    }

    const start = source.search(/\S/);
    const trimmed = source.trim();
    const end = start + trimmed.length;

    try {
      const data = JSON.parse(trimmed);
      return createJsonResult(data, trimmed, start, end, source.length);
    } catch (_) {
      // The full text can contain logs around an otherwise valid document.
    }

    if (trimmed.startsWith("<") && typeof DOMParser !== "undefined") {
      try {
        const document = parseXml(trimmed);
        return createXmlResult(document, trimmed, start, end, source.length);
      } catch (_) {
        // Extraction below also checks nested documents and collects the useful error.
      }
    }

    const json = extractJson(source);
    const xml = extractXml(source);
    const candidates = [json.success, xml.success]
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || b.end - a.end);

    if (candidates.length) {
      const candidate = candidates[0];
      if (candidate.type === "json") {
        return createJsonResult(candidate.data, candidate.text, candidate.start, candidate.end, source.length);
      }
      return createXmlResult(candidate.document, candidate.text, candidate.start, candidate.end, source.length);
    }

    if (json.detected || xml.detected) {
      const details = [
        json.error ? `JSON：${json.error}` : "",
        xml.error ? `XML：${xml.error}` : ""
      ].filter(Boolean).join("\n");
      throw new DocumentError(
        "PARSE_FAILED",
        "检测到 JSON 或 XML 内容，但文档内部存在语法错误或结构不完整。请检查括号、引号、转义字符及标签闭合。",
        details
      );
    }

    throw new DocumentError("NO_DOCUMENT", "未检测到 JSON 或 XML 文档内容。请粘贴包含对象、数组或 XML 元素的文本。");
  }

  function createJsonResult(data, text, start, end, sourceLength) {
    return {
      type: "json",
      data,
      text,
      formatted: JSON.stringify(data, null, 2),
      start,
      end,
      ignoredBefore: start,
      ignoredAfter: sourceLength - end
    };
  }

  function createXmlResult(document, text, start, end, sourceLength) {
    return {
      type: "xml",
      document,
      text,
      formatted: formatXml(document, text),
      start,
      end,
      ignoredBefore: start,
      ignoredAfter: sourceLength - end
    };
  }

  function extractJson(source) {
    let detected = false;
    let firstError = "";

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char !== "{" && char !== "[") {
        continue;
      }

      detected = true;
      const candidate = scanJsonCandidate(source, index);
      if (!candidate) {
        continue;
      }

      try {
        return {
          success: {
            type: "json",
            data: JSON.parse(candidate.text),
            text: candidate.text,
            start: index,
            end: candidate.end
          },
          detected,
          error: firstError
        };
      } catch (error) {
        if (!firstError) {
          firstError = error.message;
        }
        index = candidate.end - 1;
      }
    }

    return { success: null, detected, error: firstError };
  }

  function scanJsonCandidate(source, start) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
      } else if (char === "}" || char === "]") {
        if (stack.pop() !== char) {
          return null;
        }
        if (!stack.length) {
          return { text: source.slice(start, index + 1), end: index + 1 };
        }
      }
    }

    return null;
  }

  function extractXml(source) {
    const detected = /<\s*(?:\?|!DOCTYPE|!--|[A-Za-z_:\u00c0-\uffff])/.test(source);
    if (typeof DOMParser === "undefined") {
      return { success: null, detected, error: detected ? "当前运行环境没有 XML 解析器。" : "" };
    }

    let firstError = "";
    let index = source.indexOf("<");

    while (index !== -1) {
      const candidate = scanXmlCandidate(source, index);
      if (candidate) {
        try {
          return {
            success: {
              type: "xml",
              document: parseXml(candidate.text),
              text: candidate.text,
              start: index,
              end: candidate.end
            },
            detected: true,
            error: firstError
          };
        } catch (error) {
          if (!firstError) {
            firstError = error.message;
          }
          index = source.indexOf("<", candidate.end);
          continue;
        }
      }
      index = source.indexOf("<", index + 1);
    }

    return { success: null, detected, error: firstError };
  }

  function scanXmlCandidate(source, start) {
    let cursor = start;

    while (cursor < source.length) {
      if (source.startsWith("<!--", cursor)) {
        const end = source.indexOf("-->", cursor + 4);
        if (end === -1) return null;
        cursor = end + 3;
      } else if (source.startsWith("<?", cursor)) {
        const end = source.indexOf("?>", cursor + 2);
        if (end === -1) return null;
        cursor = end + 2;
      } else if (source.startsWith("<!DOCTYPE", cursor)) {
        const end = findDoctypeEnd(source, cursor);
        if (end === -1) return null;
        cursor = end;
      } else {
        break;
      }
      while (/\s/.test(source[cursor] || "")) cursor += 1;
    }

    const root = readXmlTag(source, cursor);
    if (!root || root.closing) {
      return null;
    }

    if (root.selfClosing) {
      return { text: source.slice(start, root.end), end: root.end };
    }

    const stack = [root.name];
    cursor = root.end;

    while (cursor < source.length) {
      const tagStart = source.indexOf("<", cursor);
      if (tagStart === -1) return null;

      if (source.startsWith("<!--", tagStart)) {
        const end = source.indexOf("-->", tagStart + 4);
        if (end === -1) return null;
        cursor = end + 3;
        continue;
      }
      if (source.startsWith("<![CDATA[", tagStart)) {
        const end = source.indexOf("]]>", tagStart + 9);
        if (end === -1) return null;
        cursor = end + 3;
        continue;
      }
      if (source.startsWith("<?", tagStart)) {
        const end = source.indexOf("?>", tagStart + 2);
        if (end === -1) return null;
        cursor = end + 2;
        continue;
      }
      if (source.startsWith("<!DOCTYPE", tagStart)) {
        const end = findDoctypeEnd(source, tagStart);
        if (end === -1) return null;
        cursor = end;
        continue;
      }

      const tag = readXmlTag(source, tagStart);
      if (!tag) {
        cursor = tagStart + 1;
        continue;
      }

      if (tag.closing) {
        stack.pop();
        if (!stack.length) {
          return { text: source.slice(start, tag.end), end: tag.end };
        }
      } else if (!tag.selfClosing) {
        stack.push(tag.name);
      }
      cursor = tag.end;
    }

    return null;
  }

  function readXmlTag(source, start) {
    if (source[start] !== "<" || source.startsWith("<!", start) || source.startsWith("<?", start)) {
      return null;
    }

    const closing = source[start + 1] === "/";
    const nameStart = start + (closing ? 2 : 1);
    const nameMatch = source.slice(nameStart).match(/^([A-Za-z_:\u00c0-\uffff][\w.:\-\u00c0-\uffff]*)/);
    if (!nameMatch) {
      return null;
    }

    const end = findTagEnd(source, nameStart + nameMatch[0].length);
    if (end === -1) {
      return null;
    }

    const inside = source.slice(nameStart + nameMatch[0].length, end - 1);
    return {
      name: nameMatch[1],
      closing,
      selfClosing: !closing && /\/\s*$/.test(inside),
      end
    };
  }

  function findTagEnd(source, start) {
    let quote = "";
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        return index + 1;
      } else if (char === "<") {
        return -1;
      }
    }
    return -1;
  }

  function findDoctypeEnd(source, start) {
    let quote = "";
    let subsetDepth = 0;
    for (let index = start + 9; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "[") {
        subsetDepth += 1;
      } else if (char === "]") {
        subsetDepth = Math.max(0, subsetDepth - 1);
      } else if (char === ">" && subsetDepth === 0) {
        return index + 1;
      }
    }
    return -1;
  }

  function parseXml(text) {
    const document = new DOMParser().parseFromString(text, "application/xml");
    const parserError = document.getElementsByTagName("parsererror")[0];
    if (parserError) {
      const message = parserError.textContent
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join("；");
      throw new Error(message || "XML 语法错误。");
    }
    if (!document.documentElement) {
      throw new Error("XML 缺少根元素。");
    }
    return document;
  }

  function formatXml(document, source) {
    const lines = [];
    const declaration = source.match(/^<\?xml[\s\S]*?\?>/i);
    if (declaration) {
      lines.push(declaration[0]);
    }

    const doctypeStart = source.indexOf("<!DOCTYPE");
    const doctypeEnd = doctypeStart === -1 ? -1 : findDoctypeEnd(source, doctypeStart);
    const doctype = doctypeEnd === -1 ? "" : source.slice(doctypeStart, doctypeEnd);

    for (const node of Array.from(document.childNodes)) {
      if (node.nodeType === 7 && /^xml$/i.test(node.target)) {
        continue;
      }
      lines.push(node.nodeType === 10 && doctype ? doctype : formatXmlNode(node, 0));
    }
    return lines.filter((line) => line !== "").join("\n");
  }

  function formatXmlNode(node, depth) {
    const indent = "  ".repeat(depth);
    switch (node.nodeType) {
      case 1:
        return formatXmlElement(node, depth);
      case 3:
        return indent + escapeXmlText(node.data);
      case 4:
        return indent + `<![CDATA[${node.data}]]>`;
      case 7:
        return indent + `<?${node.target}${node.data ? ` ${node.data}` : ""}?>`;
      case 8:
        return indent + `<!--${node.data}-->`;
      case 10:
        return indent + serializeDoctype(node);
      default:
        return "";
    }
  }

  function formatXmlElement(node, depth) {
    const indent = "  ".repeat(depth);
    const open = serializeOpenTag(node);
    const close = `</${node.nodeName}>`;
    const children = Array.from(node.childNodes);

    if (!children.length) {
      return indent + open + close;
    }

    const hasMarkup = children.some((child) => [1, 7, 8].includes(child.nodeType));
    const hasNonWhitespaceText = children.some(
      (child) => (child.nodeType === 3 && child.data.trim()) || child.nodeType === 4
    );

    if (!hasMarkup || hasNonWhitespaceText) {
      return indent + open + children.map(serializeInlineXml).join("") + close;
    }

    const content = children.filter((child) => child.nodeType !== 3 || child.data.trim());
    return [
      indent + open,
      ...content.map((child) => formatXmlNode(child, depth + 1)),
      indent + close
    ].join("\n");
  }

  function serializeInlineXml(node) {
    switch (node.nodeType) {
      case 1:
        return serializeOpenTag(node) + Array.from(node.childNodes).map(serializeInlineXml).join("") + `</${node.nodeName}>`;
      case 3:
        return escapeXmlText(node.data);
      case 4:
        return `<![CDATA[${node.data}]]>`;
      case 7:
        return `<?${node.target}${node.data ? ` ${node.data}` : ""}?>`;
      case 8:
        return `<!--${node.data}-->`;
      default:
        return "";
    }
  }

  function serializeOpenTag(node) {
    const attributes = Array.from(node.attributes || [])
      .map((attribute) => ` ${attribute.name}="${escapeXmlAttribute(attribute.value)}"`)
      .join("");
    return `<${node.nodeName}${attributes}>`;
  }

  function serializeDoctype(node) {
    if (typeof XMLSerializer !== "undefined") {
      return new XMLSerializer().serializeToString(node);
    }
    return `<!DOCTYPE ${node.name}>`;
  }

  function escapeXmlText(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeXmlAttribute(value) {
    return escapeXmlText(value).replace(/"/g, "&quot;");
  }

  return {
    DocumentError,
    parseDocument,
    extractJson,
    extractXml,
    formatXml,
    formatXmlNode
  };
});
