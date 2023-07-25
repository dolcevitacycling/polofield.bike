import { Env } from "./types";

interface Year {
  readonly type: "year";
  readonly year: number;
  readonly rules: Rule[];
}

type Levels = Readonly<
  Record<"span" | "underline" | "strong" | "ul" | "li" | "p", number>
>;
interface Rule {
  readonly type: "rule";
  readonly buffer: readonly BufferEntry[];
}
interface BufferEntry {
  readonly text: string;
  readonly levels: Levels;
}

export class DocCleaner implements HTMLRewriterDocumentContentHandlers {
  getContent: () => string;
  constructor(getContent: () => string) {
    this.getContent = getContent;
  }
  comments(comment: Comment) {
    comment.remove();
  }
  text(text: Text) {
    text.remove();
  }
  end(end: DocumentEnd) {
    end.append(this.getContent());
  }
}

function joinBuffer(buffer: readonly BufferEntry[]): readonly BufferEntry[] {
  const result: BufferEntry[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const entry = buffer[i];
    const prev = result[result.length - 1];
    if (prev?.levels === entry.levels) {
      result[result.length - 1] = { ...prev, text: prev.text + entry.text };
    } else {
      result.push(entry);
    }
  }
  return result.filter((entry) => !/^\s*(&nbsp;\s*)*$/.test(entry.text));
}

export class ScheduleScraper implements HTMLRewriterElementContentHandlers {
  state: "initial" | "start" | "copy" | "done" = "initial";
  levels: Levels = {
    span: 0,
    underline: 0,
    strong: 0,
    ul: 0,
    li: 0,
    p: 0,
  };
  years: Year[] = [];
  inSpan: boolean = false;
  buffer: BufferEntry[] = [];
  element(element: Element) {
    switch (this.state) {
      case "initial": {
        if (
          element.tagName === "html" ||
          element.tagName === "body" ||
          element.tagName === "div"
        ) {
          element.remove();
        } else {
          if (
            element.tagName === "h1" &&
            element.getAttribute("id") === "versionHeadLine"
          ) {
            this.state = "start";
          }
          element.remove();
        }
        break;
      }
      case "start": {
        if (
          element.tagName === "div" &&
          element.getAttribute("class")?.match(/\bpageContent\b/)
        ) {
          this.state = "copy";
          element.remove();
          element.onEndTag((endTag) => {
            this.state = "done";
            this.flushBuffer(endTag);
          });
        }
        break;
      }
      case "copy": {
        const levels = this.levels;
        switch (element.tagName) {
          case "strong": {
            this.levels = { ...levels, strong: levels.strong + 1 };
            element.onEndTag(() => {
              this.levels = levels;
            });
            break;
          }
          case "li": {
            this.levels = { ...levels, li: levels.li + 1 };
            element.onEndTag((endTag) => {
              this.levels = levels;
              this.flushBuffer(endTag);
            });
            break;
          }
          case "p": {
            this.levels = { ...levels, p: levels.p + 1 };
            element.onEndTag((endTag) => {
              this.levels = levels;
              this.flushBuffer(endTag);
            });
            break;
          }
          case "span": {
            this.levels = {
              ...levels,
              span: levels.span + 1,
              underline: element
                .getAttribute("style")
                ?.match(/\btext-decoration: underline;\b/)
                ? levels.underline + 1
                : levels.underline,
            };
            element.onEndTag(() => {
              this.levels = levels;
            });
            break;
          }
          default: {
            break;
          }
        }
        element.remove();
        break;
      }
      case "done": {
        element.remove();
        break;
      }
    }
  }
  text(element: Text) {
    if (
      element.text.length > 0 &&
      this.state === "copy" &&
      this.levels.span > 0
    ) {
      const m = element.text.match(/^\d{4}$/);
      if (m) {
        this.buffer.splice(0, this.buffer.length);
        this.years.push({
          type: "year",
          year: parseInt(m[0], 10),
          rules: [],
        });
      } else if (this.years.length > 0) {
        this.buffer.push({
          levels: this.levels,
          text: element.text,
        });
      }
    }
    element.remove();
  }
  flushBuffer(endTag: EndTag) {
    if (this.buffer.length === 0) {
      return;
    }
    this.years[this.years.length - 1]?.rules.push({
      type: "rule",
      buffer: joinBuffer(this.buffer.splice(0, this.buffer.length)),
    });
  }
}

export async function handleCron(
  event: ScheduledController,
  env: Env,
): Promise<void> {}
