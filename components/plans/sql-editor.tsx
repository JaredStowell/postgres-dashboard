"use client";

import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";

export function SqlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="267px"
      theme="dark"
      extensions={[sql({ dialect: PostgreSQL })]}
      onChange={onChange}
      onCreateEditor={(view) => {
        view.contentDOM.setAttribute("aria-label", "SQL statement");
      }}
      basicSetup={{
        foldGutter: false,
        highlightActiveLineGutter: false,
        lineNumbers: true,
      }}
      aria-label="SQL statement"
    />
  );
}
