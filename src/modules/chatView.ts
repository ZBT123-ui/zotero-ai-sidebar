import katex from "katex";
import "katex/contrib/mhchem";

export function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    tag,
  ) as unknown as HTMLElementTagNameMap[K];
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const paths = {
  plus: "M12 5v14M5 12h14",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  edit: "M14 5l5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z",
  copy: "M9 9h12v12H9zM15 6V3H3v12h3",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 7M4 12l2 7a7 7 0 0 0 12-2",
  chat: "M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0zM7 10h10M7 14h6",
  arrow: "M12 20V4M5 11l7-7 7 7",
  export: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
} as const;

export function icon(doc: Document, name: keyof typeof paths) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}

export function action(
  doc: Document,
  label: string,
  name?: keyof typeof paths,
  className = "zai-icon-button",
) {
  const button = html(doc, "button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  if (name) button.append(icon(doc, name));
  else button.textContent = label;
  return button;
}

function appendMath(parent: HTMLElement, tex: string, display: boolean) {
  const doc = parent.ownerDocument!;
  const holder = html(
    doc,
    display ? "div" : "span",
    display ? "zai-math-display" : "zai-math",
  );
  try {
    // KaTeX output is generated locally from TeX; model HTML is never inserted directly.
    holder.innerHTML = katex.renderToString(tex, {
      displayMode: display,
      output: "htmlAndMathml",
      throwOnError: false,
      trust: false,
      maxSize: 40,
      maxExpand: 1000,
    });
  } catch {
    holder.textContent = display ? `\\[${tex}\\]` : `$${tex}$`;
    holder.classList.add("zai-math-error");
  }
  parent.append(holder);
}

function mathToken(value: string) {
  if (value.startsWith("\\(") && value.endsWith("\\)"))
    return { tex: value.slice(2, -2), display: false };
  if (value.startsWith("$$") && value.endsWith("$$"))
    return { tex: value.slice(2, -2), display: true };
  if (value.startsWith("$") && value.endsWith("$"))
    return { tex: value.slice(1, -1), display: false };
  if (value.startsWith("\\ce{")) return { tex: value, display: false };
  return undefined;
}

function looksLikeRawMath(line: string) {
  return /^\s*(?:\\(?:frac|dfrac|tfrac|sqrt|mathbb|mathbf|mathrm|operatorname|left|right|begin|end|text|log|ln|sum|prod|int|partial|nabla|alpha|beta|gamma|delta|theta|tau|sim|approx|underbrace|overline|underline|cdot|times|pm|leq|geq|infty)\b|[&_^{}])/.test(
    line,
  );
}

function looksLikeMathContinuation(line: string) {
  return (
    looksLikeRawMath(line) ||
    /^\s*[A-Za-z][A-Za-z0-9]*\s*\([^)]*[{}_][^)]*\)/.test(line) ||
    /[{}_^&\\]/.test(line)
  );
}

function inline(parent: HTMLElement, source: string, depth = 0) {
  const doc = parent.ownerDocument!;
  if (depth > 3) {
    parent.append(doc.createTextNode(source));
    return;
  }
  const pattern =
    /(\\\([^\n]*?\\\)|\$\$[^\n]*?\$\$|\$(?!\s)[^$\n]+?\$|\\ce\{[^}\n]+\}|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let start = 0;
  for (const match of source.matchAll(pattern)) {
    parent.append(doc.createTextNode(source.slice(start, match.index)));
    const value = match[0];
    const math = mathToken(value);
    if (math) appendMath(parent, math.tex, math.display);
    else if (value.startsWith("`"))
      parent.append(html(doc, "code", "", value.slice(1, -1)));
    else if (value.startsWith("**")) {
      const node = html(doc, "strong");
      inline(node, value.slice(2, -2), depth + 1);
      parent.append(node);
    } else if (value.startsWith("*")) {
      const node = html(doc, "em");
      inline(node, value.slice(1, -1), depth + 1);
      parent.append(node);
    } else {
      const split = value.indexOf("](");
      const link = html(doc, "a", "", value.slice(1, split));
      link.href = value.slice(split + 2, -1);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(link.href);
      });
      parent.append(link);
    }
    start = (match.index || 0) + value.length;
  }
  parent.append(doc.createTextNode(source.slice(start)));
}

// No innerHTML, remote images, or arbitrary model-supplied markup enters a privileged Zotero document.
export function renderMarkdown(target: HTMLElement, source: string) {
  target.replaceChildren();
  const doc = target.ownerDocument!;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const sameLineDisplay = /^\s*(?:\\\[|\$\$)(.*?)(?:\\\]|\$\$)\s*$/.exec(
      line,
    );
    if (sameLineDisplay) {
      appendMath(target, sameLineDisplay[1], true);
      index++;
      continue;
    }
    if (/^\s*(?:\\\[|\$\$)\s*$/.test(line)) {
      const opening = /^\s*\\\[/.test(line) ? "\\]" : "$$";
      const mathLines: string[] = [];
      index++;
      while (index < lines.length && !lines[index].includes(opening))
        mathLines.push(lines[index++]);
      if (index < lines.length) index++;
      appendMath(target, mathLines.join("\n"), true);
      continue;
    }
    if (/^\s*\\begin\{(?:aligned|gathered|equation\*?)\}/.test(line)) {
      const mathLines = [line];
      index++;
      while (index < lines.length) {
        mathLines.push(lines[index]);
        if (/\\end\{(?:aligned|gathered|equation\*?)\}/.test(lines[index++]))
          break;
      }
      appendMath(target, mathLines.join("\n"), true);
      continue;
    }
    if (looksLikeRawMath(line)) {
      const mathLines = [line];
      index++;
      while (
        index < lines.length &&
        (looksLikeMathContinuation(lines[index]) || !lines[index].trim())
      )
        mathLines.push(lines[index++]);
      const source = mathLines.join("\n").trim();
      const wrapped = /\\begin\{/.test(source)
        ? source
        : "\\begin{aligned}\n" + source + "\n\\end{aligned}";
      appendMath(target, wrapped, true);
      continue;
    }
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]))
        code.push(lines[index++]);
      if (index < lines.length) index++;
      const wrapper = html(doc, "div", "zai-code");
      const bar = html(doc, "div", "zai-code-bar", language || "code");
      const copy = action(doc, "复制代码", "copy");
      copy.addEventListener("click", () => {
        copyText(code.join("\n"));
        copy.title = "已复制";
      });
      bar.append(copy);
      const pre = html(doc, "pre");
      pre.append(html(doc, "code", "", code.join("\n")));
      wrapper.append(bar, pre);
      target.append(wrapper);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const node = html(doc, `h${heading[1].length + 2}` as "h3");
      inline(node, heading[2]);
      target.append(node);
      index++;
      continue;
    }
    if (
      index + 1 < lines.length &&
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])
    ) {
      const cells = (row: string) =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
      const wrapper = html(doc, "div", "zai-table-wrap");
      const table = html(doc, "table");
      const head = html(doc, "thead");
      const row = html(doc, "tr");
      for (const value of cells(line)) {
        const cell = html(doc, "th");
        inline(cell, value.trim());
        row.append(cell);
      }
      head.append(row);
      table.append(head);
      index += 2;
      const body = html(doc, "tbody");
      while (
        index < lines.length &&
        lines[index].includes("|") &&
        lines[index].trim()
      ) {
        const row = html(doc, "tr");
        for (const value of cells(lines[index++])) {
          const cell = html(doc, "td");
          inline(cell, value.trim());
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      wrapper.append(table);
      target.append(wrapper);
      continue;
    }
    const list = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.exec(line);
    if (list) {
      const ordered = /^\s*\d/.test(line);
      const node = html(doc, ordered ? "ol" : "ul");
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        const li = html(doc, "li");
        inline(li, lines[index++].replace(pattern, ""));
        node.append(li);
      }
      target.append(node);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = html(doc, "blockquote");
      inline(quote, line.replace(/^>\s?/, ""));
      target.append(quote);
      index++;
      continue;
    }
    const paragraph = html(doc, "p");
    inline(paragraph, line);
    target.append(paragraph);
    index++;
  }
}

export function copyText(text: string) {
  new addon.data.ztoolkit.Clipboard().addText(text, "text/plain").copy();
}
