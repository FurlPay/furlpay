import { Fragment, type ReactNode } from "react";

/*
 * A ~50-line tokenizer, instead of a syntax-highlighting dependency.
 *
 * The landing page shows five short snippets and their JSON responses. Shiki
 * (already used in /docs) is a build-time highlighter that would have to run on
 * the server for these, and any client-side highlighter is 50-200KB for what a
 * single regex does here. Correctness bar: strings, comments, numbers, keywords
 * and JSON keys. Anything it does not recognise stays plain — never mangled.
 */

const TOKEN =
  /(\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(const|let|await|async|import|from|new|return|function|export|true|false|null)\b|\b(\d+(?:\.\d+)?)\b/g;

const CLASS = {
  comment: "text-[#5c6370] italic",
  string: "text-[#c3e88d]",
  keyword: "text-[#c792ea]",
  number: "text-[#f78c6c]",
  key: "text-[#82aaff]",
} as const;

/** Highlight a TypeScript / shell snippet. */
export function code(source: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of source.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    const [full, comment, string, keyword, number] = m;
    const cls = comment
      ? CLASS.comment
      : string
        ? CLASS.string
        : keyword
          ? CLASS.keyword
          : number
            ? CLASS.number
            : "";
    out.push(
      <span className={cls} key={`t${i++}`}>
        {full}
      </span>
    );
    last = index + full.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return <Fragment>{out}</Fragment>;
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|\b(-?\d+(?:\.\d+)?)\b/g;

/** Highlight a JSON response: keys blue, string values green, literals purple. */
export function json(source: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of source.matchAll(JSON_TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    const [full, str, colon, literal, number] = m;
    if (str && colon) {
      out.push(
        <Fragment key={`t${i++}`}>
          <span className={CLASS.key}>{str}</span>
          {colon}
        </Fragment>
      );
    } else {
      out.push(
        <span className={str ? CLASS.string : literal ? CLASS.keyword : CLASS.number} key={`t${i++}`}>
          {full}
        </span>
      );
    }
    last = index + full.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return <Fragment>{out}</Fragment>;
}
