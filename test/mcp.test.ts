import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliJs = path.resolve(here, "../src/cli.js"); // dist-test/src/cli.js at runtime

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

test("MCP server end-to-end over stdio", async () => {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-mcp-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliJs, "mcp", "--vault", vaultDir, "--no-watch"],
    env: { ...process.env, VORTEX_NOTES_NO_SEMANTIC: "1" },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "append_daily",
      "edit_note",
      "list_notes",
      "read_note",
      "recent_activity",
      "search_notes",
      "write_note",
    ]);

    // write → read → edit → search
    const created = await client.callTool({
      name: "write_note",
      arguments: { title: "Test Plan", content: "We test the MCP flow with quokkas.", folder: "projects" },
    });
    assert.match(textOf(created), /projects\/test-plan\.md/);

    const read = await client.callTool({
      name: "read_note",
      arguments: { path: "projects/test-plan.md" },
    });
    assert.match(textOf(read), /quokkas/);

    await client.callTool({
      name: "edit_note",
      arguments: {
        path: "projects/test-plan.md",
        operation: "append",
        content: "Addendum: also wombats.",
      },
    });

    const found = await client.callTool({
      name: "search_notes",
      arguments: { query: "wombats", mode: "keyword" },
    });
    assert.match(textOf(found), /projects\/test-plan\.md/);

    const daily = await client.callTool({
      name: "append_daily",
      arguments: { content: "tested the mcp server" },
    });
    assert.match(textOf(daily), /daily\//);

    const recent = await client.callTool({ name: "recent_activity", arguments: {} });
    assert.match(textOf(recent), /test-plan\.md/);
  } finally {
    await client.close();
  }
});

test("read-only mode blocks writes", async () => {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-mcp-ro-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliJs, "mcp", "--vault", vaultDir, "--no-watch", "--read-only"],
    env: { ...process.env, VORTEX_NOTES_NO_SEMANTIC: "1" },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  try {
    const res = await client.callTool({
      name: "write_note",
      arguments: { title: "Nope", content: "should fail" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /read-only/i);
  } finally {
    await client.close();
  }
});
