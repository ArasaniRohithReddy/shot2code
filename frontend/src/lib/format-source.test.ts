import {
  canFormatLanguage,
  describeUnsupportedLanguage,
  formatSource,
} from "./format-source";

function expectFormatted(content: string, language: "html" | "css" | "javascript" | "json") {
  const result = formatSource(content, language);
  if (result.status !== "formatted") {
    throw new Error(
      `Expected formatting to succeed, got ${result.status}: ${result.reason}`
    );
  }
  return result.content;
}

describe("formatSource language support", () => {
  it("formats only the four safe languages", () => {
    expect(canFormatLanguage("html")).toBe(true);
    expect(canFormatLanguage("css")).toBe(true);
    expect(canFormatLanguage("javascript")).toBe(true);
    expect(canFormatLanguage("json")).toBe(true);

    ["jsx", "tsx", "typescript", "vue", "markdown", "yaml", "xml", "text"].forEach(
      (language) => {
        expect(canFormatLanguage(language as "jsx")).toBe(false);
      }
    );
  });

  it("refuses framework source instead of guessing", () => {
    const source = "export default function App() { return <div>hi</div>; }";
    const result = formatSource(source, "tsx");
    expect(result.status).toBe("unsupported");
    expect(result.content).toBe(source);
    expect(describeUnsupportedLanguage("tsx")).toContain("component source");
  });

  it("reports empty files as unchanged", () => {
    const result = formatSource("   \n", "css");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe("   \n");
  });
});

describe("formatSource json", () => {
  it("pretty prints with two-space indentation", () => {
    expect(expectFormatted('{"a":1,"b":[1,2]}', "json")).toBe(
      ['{', '  "a": 1,', '  "b": [', "    1,", "    2", "  ]", "}"].join("\n")
    );
  });

  it("keeps invalid JSON untouched", () => {
    const source = "{a:1}";
    const result = formatSource(source, "json");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe(source);
    expect(result.reason).toContain("not valid JSON");
  });

  it("preserves a trailing newline", () => {
    expect(expectFormatted('{"a":1}\n', "json")).toBe('{\n  "a": 1\n}\n');
  });
});

describe("formatSource css", () => {
  it("expands minified rules", () => {
    const formatted = expectFormatted(
      "body{font-family:system-ui;margin:0;padding:40px;background:#f5f3ff}button{padding:12px 18px}",
      "css"
    );
    expect(formatted).toBe(
      [
        "body {",
        "  font-family: system-ui;",
        "  margin: 0;",
        "  padding: 40px;",
        "  background: #f5f3ff",
        "}",
        "button {",
        "  padding: 12px 18px",
        "}",
      ].join("\n")
    );
  });

  it("indents nested at-rules", () => {
    const formatted = expectFormatted(
      "@media (min-width:600px){.grid{display:grid;gap:8px}}",
      "css"
    );
    expect(formatted).toBe(
      [
        "@media (min-width:600px) {",
        "  .grid {",
        "    display: grid;",
        "    gap: 8px",
        "  }",
        "}",
      ].join("\n")
    );
  });

  it("never turns a nested pseudo-class selector into a declaration", () => {
    const formatted = expectFormatted("a{color:red;&:hover{color:blue}}", "css");
    expect(formatted).toContain("&:hover {");
    expect(formatted).not.toContain("&: hover");
  });

  it("leaves url() and string contents alone", () => {
    const formatted = expectFormatted(
      '.a{background:url(data:image/svg+xml;base64,AAA=);content:"a;b{c}"}',
      "css"
    );
    expect(formatted).toContain("url(data:image/svg+xml;base64,AAA=)");
    expect(formatted).toContain('content: "a;b{c}"');
  });

  it("is idempotent", () => {
    const once = expectFormatted("body{margin:0;color:red}", "css");
    expect(formatSource(once, "css").status).toBe("unchanged");
  });

  it("bails on an unterminated comment", () => {
    const source = "body{color:red} /* oops";
    expect(formatSource(source, "css").content).toBe(source);
  });
});

describe("formatSource javascript", () => {
  it("breaks minified statements onto their own lines", () => {
    const formatted = expectFormatted(
      "function run(){var a=1;var b=2;return a+b}",
      "javascript"
    );
    expect(formatted).toBe(
      [
        "function run() {",
        "  var a=1;",
        "  var b=2;",
        "  return a+b",
        "}",
      ].join("\n")
    );
  });

  it("does not break the semicolons in a for header", () => {
    const formatted = expectFormatted(
      "for(var i=0;i<3;i++){total+=i;log(i)}",
      "javascript"
    );
    expect(formatted).toBe(
      ["for(var i=0;i<3;i++) {", "  total+=i;", "  log(i)", "}"].join("\n")
    );
  });

  it("keeps short object literals inline", () => {
    const formatted = expectFormatted(
      "var config={a:1,b:2};render(config);",
      "javascript"
    );
    expect(formatted).toBe(["var config={a:1,b:2};", "render(config);"].join("\n"));
  });

  it("preserves template literals byte for byte", () => {
    const source = "var t=`a;b{c}\n  keep   spacing`;run(t);";
    const formatted = expectFormatted(source, "javascript");
    expect(formatted).toContain("`a;b{c}\n  keep   spacing`");
  });

  it("preserves regular expressions containing braces and semicolons", () => {
    const source = "var re=/a{2};b/g;var n=10/2;test(re,n);";
    const formatted = expectFormatted(source, "javascript");
    expect(formatted).toContain("/a{2};b/g");
    expect(formatted).toContain("10/2");
  });

  it("keeps a newline after return so automatic semicolon insertion is unchanged", () => {
    const source = "function f() {\nreturn\nvalue;\n}";
    const formatted = expectFormatted(source, "javascript");
    expect(formatted.split("\n")).toEqual([
      "function f() {",
      "  return",
      "  value;",
      "}",
    ]);
  });

  it("keeps line comments on their own line", () => {
    const formatted = expectFormatted(
      "var a=1;// note\nvar b=2;",
      "javascript"
    );
    expect(formatted.split("\n")).toEqual(["var a=1;", "// note", "var b=2;"]);
  });

  it("bails out rather than guess after an ambiguous closing brace", () => {
    const source = "if(a){b()}\n/re/.test(c);";
    const result = formatSource(source, "javascript");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe(source);
    expect(result.reason).toContain("ambiguous");
  });

  it("bails out on unbalanced brackets", () => {
    const source = "function broken(){var a=1;";
    const result = formatSource(source, "javascript");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe(source);
  });

  it("is idempotent", () => {
    const once = expectFormatted(
      "function run(){var a=1;if(a){go()}}",
      "javascript"
    );
    expect(formatSource(once, "javascript").status).toBe("unchanged");
  });
});

describe("formatSource html", () => {
  const MINIFIED =
    '<!doctype html><html><head><style>body{font-family:system-ui;margin:0}</style></head>' +
    "<body><h1>Responsive test project</h1><p>This local project verifies the preview.</p>" +
    "<button>Action</button><script>document.querySelector('button').onclick=()=>{document.body.dataset.clicked='true'}</script></body></html>";

  it("turns a one-line document into a readable tree", () => {
    const formatted = expectFormatted(MINIFIED, "html");
    expect(formatted.split("\n")).toEqual([
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <style>",
      "      body {",
      "        font-family: system-ui;",
      "        margin: 0",
      "      }",
      "    </style>",
      "  </head>",
      "  <body>",
      "    <h1>Responsive test project</h1>",
      "    <p>This local project verifies the preview.</p>",
      "    <button>Action</button>",
      "    <script>",
      "      document.querySelector('button').onclick=()=>{document.body.dataset.clicked='true'}",
      "    </script>",
      "  </body>",
      "</html>",
    ]);
  });

  it("is idempotent", () => {
    const once = expectFormatted(MINIFIED, "html");
    expect(formatSource(once, "html").status).toBe("unchanged");
  });

  it("keeps whitespace between inline elements", () => {
    const formatted = expectFormatted(
      "<body><div><span>one</span> <span>two</span></div></body>",
      "html"
    );
    expect(formatted.split("\n")).toEqual([
      "<body>",
      "  <div><span>one</span> <span>two</span></div>",
      "</body>",
    ]);
  });

  it("splits a block element whose content outgrows one line", () => {
    const sentence =
      "This paragraph is deliberately long so that the formatter has to move its text onto a line entirely of its own.";
    const formatted = expectFormatted(`<body><p>${sentence}</p></body>`, "html");
    expect(formatted.split("\n")).toEqual([
      "<body>",
      "  <p>",
      `    ${sentence}`,
      "  </p>",
      "</body>",
    ]);
  });

  it("leaves pre and textarea content untouched", () => {
    const source = "<div><pre>  a\n    b</pre><textarea> x  y </textarea></div>";
    const formatted = expectFormatted(source, "html");
    expect(formatted).toContain("<pre>  a\n    b</pre>");
    expect(formatted).toContain("<textarea> x  y </textarea>");
  });

  it("does not format non-JavaScript script bodies", () => {
    const source =
      '<body><script type="text/template">{{ a }}  {{ b }}</script></body>';
    const formatted = expectFormatted(source, "html");
    expect(formatted).toContain("{{ a }}  {{ b }}");
  });

  it("indents list items without nesting them into each other", () => {
    const formatted = expectFormatted(
      "<ul><li>one<li>two</ul>",
      "html"
    );
    expect(formatted.split("\n")).toEqual([
      "<ul>",
      "  <li>one",
      "  <li>two",
      "</ul>",
    ]);
  });

  it("keeps comments and void elements on their own lines", () => {
    const formatted = expectFormatted(
      "<head><!-- meta --><meta charset=\"utf-8\"><link rel=\"icon\" href=\"a.png\"></head>",
      "html"
    );
    expect(formatted.split("\n")).toEqual([
      "<head>",
      "  <!-- meta -->",
      '  <meta charset="utf-8">',
      '  <link rel="icon" href="a.png">',
      "</head>",
    ]);
  });

  it("keeps an unterminated tag untouched", () => {
    const source = '<div><span class="a"';
    const result = formatSource(source, "html");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe(source);
  });

  it("changes only whitespace", () => {
    const formatted = expectFormatted(MINIFIED, "html");
    expect(formatted.replace(/\s+/g, "")).toBe(MINIFIED.replace(/\s+/g, ""));
  });
});
