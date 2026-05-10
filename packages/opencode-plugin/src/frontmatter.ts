export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseMarkdown(content: string): ParsedMarkdown {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  return {
    frontmatter: parseYamlSubset(match[1]),
    body: match[2].trim(),
  };
}

function parseYamlSubset(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) {
      continue;
    }

    const key = keyMatch[1];
    const rawValue = keyMatch[2] ?? "";

    if (rawValue === "|" || rawValue === ">") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].replace(/^\s{2}/, ""));
      }
      result[key] = block.join(rawValue === ">" ? " " : "\n").trim();
      continue;
    }

    if (rawValue === "") {
      const items: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const itemMatch = lines[cursor].match(/^\s*-\s+(.+)$/);
        if (!itemMatch) {
          break;
        }
        items.push(parseScalar(itemMatch[1]) as string);
        cursor += 1;
      }
      if (items.length > 0) {
        result[key] = items;
        index = cursor - 1;
      }
      continue;
    }

    result[key] = parseScalar(rawValue);
  }

  return result;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  return trimmed.replace(/^['"]|['"]$/g, "");
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
