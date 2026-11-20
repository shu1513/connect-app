import Link from "next/link";
import { Fragment } from "react";
import type { Block, Inline } from "./parse";

/** Draws what the reader (parse.ts) gives. Only fixed documents of the site are ever drawn with this, never anything a person typed. */
function Words({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.t === "text") return <Fragment key={index}>{part.v}</Fragment>;
        if (part.t === "bold")
          return (
            <strong key={index}>
              <Words parts={part.c} />
            </strong>
          );
        // A blank that is not filled in yet stands out, so nobody takes a draft for a finished text.
        if (part.t === "blank")
          return (
            <mark key={index} className="rounded bg-amber-100 px-0.5 text-inherit">
              {part.v}
            </mark>
          );
        return part.outside ? (
          <a key={index} href={part.href} rel="noopener noreferrer" className="underline underline-offset-2">
            <Words parts={part.c} />
          </a>
        ) : (
          <Link key={index} href={part.href} className="underline underline-offset-2">
            <Words parts={part.c} />
          </Link>
        );
      })}
    </>
  );
}

export function LegalText({ blocks }: { blocks: Block[] }) {
  return (
    <div className="text-sm leading-relaxed">
      {blocks.map((block, index) => {
        if (block.t === "heading") {
          // The page draws the document's own title itself (level 1), above the lines about its version.
          if (block.level === 1) return null;
          return block.level === 2 ? (
            <h2 key={index} className="mt-8 text-lg font-bold">
              <Words parts={block.c} />
            </h2>
          ) : (
            <h3 key={index} className="mt-6 font-bold">
              <Words parts={block.c} />
            </h3>
          );
        }
        if (block.t === "paragraph")
          return (
            <p key={index} className="mt-3">
              <Words parts={block.c} />
            </p>
          );
        if (block.t === "list") {
          const items = block.items.map((item, at) => (
            <li key={at}>
              <Words parts={item} />
            </li>
          ));
          return block.ordered ? (
            <ol key={index} start={block.start} className="mt-3 list-decimal space-y-1 pl-6">
              {items}
            </ol>
          ) : (
            <ul key={index} className="mt-3 list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        if (block.t === "table")
          return (
            <div key={index} className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left align-top">
                <thead>
                  <tr>
                    {block.head.map((cell, at) => (
                      <th key={at} scope="col" className="border border-neutral-300 px-2 py-1 font-bold">
                        <Words parts={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, at) => (
                    <tr key={at}>
                      {row.map((cell, column) => (
                        <td key={column} className="border border-neutral-300 px-2 py-1 align-top">
                          <Words parts={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (block.t === "quote")
          return (
            <blockquote key={index} className="mt-3 border-l-4 border-neutral-300 pl-3">
              {block.lines.map((line, at) => (
                <p key={at}>
                  <Words parts={line} />
                </p>
              ))}
            </blockquote>
          );
        return <hr key={index} className="mt-8 border-neutral-300" />;
      })}
    </div>
  );
}
