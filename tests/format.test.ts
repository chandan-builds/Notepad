import { describe, expect, it } from "vitest";
import { applyEditorCommand, countWords, formattingMarks, stripFormatting } from "@/editor/format";

describe("editor formatting", () => {
  it("wraps and clears bold, italic, underline, and code", () => {
    const bold = applyEditorCommand("hello", 0, 5, "bold");
    expect(bold.text).toBe("**hello**");
    expect(bold).toMatchObject({ anchor: 2, head: 7 });

    const italic = applyEditorCommand("hello", 0, 5, "italic");
    expect(italic.text).toBe("*hello*");

    const underline = applyEditorCommand("hello", 0, 5, "underline");
    expect(underline.text).toBe("<u>hello</u>");

    const code = applyEditorCommand("hello", 0, 5, "code");
    expect(code.text).toBe("`hello`");

    const block = applyEditorCommand("one\ntwo", 0, 7, "code");
    expect(block.text).toBe("```\none\ntwo\n```");

    expect(applyEditorCommand(bold.text, 0, bold.text.length, "clear").text).toBe("hello");
    expect(stripFormatting("**two** words")).toBe("two words");
    expect(countWords("**two** words")).toBe(2);
    expect(countWords("   ")).toBe(0);
  });

  it("unwraps a marker pair instead of nesting it", () => {
    const wrapped = applyEditorCommand("**hello**", 0, 9, "bold");
    expect(wrapped.text).toBe("hello");
  });

  it("marks formatted ranges without overlap", () => {
    const text = "**bold** *italic* <u>line</u> `code`";
    const marks = formattingMarks(text);
    expect(marks.some((mark) => mark.className === "cm-fmt-bold")).toBe(true);
    expect(marks.some((mark) => mark.className === "cm-fmt-italic")).toBe(true);
    expect(marks.some((mark) => mark.className === "cm-fmt-underline")).toBe(true);
    expect(marks.some((mark) => mark.className === "cm-fmt-code")).toBe(true);
    for (let index = 1; index < marks.length; index += 1) {
      expect(marks[index].from).toBeGreaterThanOrEqual(marks[index - 1].to);
    }
  });
});
