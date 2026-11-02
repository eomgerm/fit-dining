import type { TermsBlock, TermsDocument } from "../model/terms-content";

// 가입 시트의 "보기" 모달과 /terms, /privacy가 같은 본문을 보여 준다.
// 문서 제목이 h1(페이지)이면 조 제목은 h2, 제목이 h2(모달)이면 h3이다.
export function TermsBody({
  content,
  headingLevel,
}: {
  content: TermsDocument;
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="space-y-5 text-body-md break-words break-keep">
      {content.preamble && (
        <div className="space-y-2">
          {content.preamble.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
      {content.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <Heading className="text-title-sm">{section.heading}</Heading>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
      <p className="text-body-sm text-ink-muted">
        시행일:{" "}
        <time dateTime={content.effectiveDate}>{content.effectiveDate}</time>
      </p>
    </div>
  );
}

function Block({ block }: { block: TermsBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <ul className="space-y-3">
          {block.rows.map((row) => (
            <li key={row.label} className="rounded-md border border-line p-3">
              <p className="text-label-md">{row.label}</p>
              <dl className="mt-1 space-y-1">
                {block.columns.map((column, index) => (
                  <div key={column}>
                    <dt className="text-body-sm text-ink-muted">{column}</dt>
                    <dd>{row.cells[index]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      );
  }
}
