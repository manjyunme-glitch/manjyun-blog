import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMarkdownBlock,
  mediaToMarkdown
} from "@/lib/admin/media-markdown";
import { renderMarkdown } from "@/lib/content/markdown";

test("media Markdown escapes filenames without changing the managed URL", () => {
  const hostileName = String.raw`x](https://evil.example/pixel.png) [a]\name.png`;
  const url = "/uploads/fixed-image.png";
  const markdown = mediaToMarkdown({
    originalName: hostileName,
    mime: "image/png",
    url
  });
  const rendered = renderMarkdown(markdown);

  assert.match(rendered.html, /src="\/uploads\/fixed-image\.png"/);
  assert.doesNotMatch(rendered.html, /(?:src|href)="https:\/\/evil\.example/);
  assert.match(rendered.html, /alt="x\]\(https:\/\/evil\.example\/pixel\.png\) \[a\]\\name\.png"/);
});

test("audio card titles round-trip escaped closing brackets", () => {
  const markdown = mediaToMarkdown({
    originalName: String.raw`mix]\demo.mp3`,
    mime: "audio/mpeg",
    url: "/uploads/fixed-audio.mp3"
  });
  const rendered = renderMarkdown(`Audio:\n${markdown}`);

  assert.match(rendered.html, /<strong>mix\]\\demo\.mp3<\/strong>/);
  assert.match(rendered.html, /src="\/uploads\/fixed-audio\.mp3"/);
  assert.doesNotMatch(rendered.html, /\[audio:/);
});

test("appending a media block preserves current text and stable spacing", () => {
  assert.equal(
    appendMarkdownBlock("Current edit", "![image](/uploads/image.png)"),
    "Current edit\n\n![image](/uploads/image.png)\n"
  );
  assert.equal(
    appendMarkdownBlock("Current edit\n", "[file](/uploads/file.pdf)"),
    "Current edit\n\n[file](/uploads/file.pdf)\n"
  );
});
