# Directory submission kit

Paste-ready answers for the Claude connector directory, the Claude plugin directory and the ChatGPT app directory.

## Before you submit
- Deploy the server changes: privacy and terms pages and tool labels (`npm run cf:deploy`).
- Push the repo to GitHub, so the plugin folder and marketplace file are public.
- Finish your own test of `https://vortex-notes.pages.dev/mcp` in Claude and ChatGPT: the Claude form asks you to confirm you've tested every tool.
- Reviewer account: its 12 words are in `~/vortex-reviewer/identity-output.txt`. Paste them only into the portals' private reviewer fields.
- ChatGPT only: record a 1–2 minute screen video (connect → approve → ask the launch code → remember a fact), upload it unlisted (YouTube or Loom), and put the link in `plugins/chatgpt/plugin.json`.

## Claude connector directory
_claude.ai/directory/manage → Submit new → MCP connector_ · https://claude.ai/directory/manage

**1. Connection · Server URL**

https://vortex-notes.pages.dev/mcp

**3. Listing · Server name**

Vortex Notes

**3. Listing · One-liner (≤200)**

Shared, end-to-end encrypted markdown memory for you and your AI: search, read and write your notes, keep a daily log, and remember facts.

**3. Listing · Description (≤2000)**

```
Vortex Notes is markdown notes that you and your AI tools share, end-to-end encrypted. Connect it and Claude can search your notes in any language, read a note, load everything about a topic in one step, add to your daily note, remember facts (a new fact supersedes the old one instead of deleting it), and create or edit notes.

Your notes sync to your phone, browser and computer, where they're a plain folder of markdown that works with Obsidian or any editor. Other AI tools (Claude Code, ChatGPT, Cursor and others) can share the same notes, each with its own key that you can revoke.

When you connect, you choose read + write or read-only. Because chat apps can only reach a server, the server holds this connection's key and can read the notes it may access; everything else stays end-to-end encrypted. Free and open source (MIT).
```

**3. Listing · Categories**

Productivity · Knowledge management (pick the closest the form offers)

**3. Listing · Documentation URL**

https://vortex-notes.pages.dev/#connect-claude

**3. Listing · Privacy policy URL**

https://vortex-notes.pages.dev/privacy

**3. Listing · Support contact**

https://github.com/vortex-303/vortex-notes/issues

**3. Listing · Icon**

~/vortex-notes/assets/icons/icon-512.png

**3. Listing · URL slug (permanent)**

vortex-notes

**4. Use cases**

Long-term memory across conversations: ask what your notes say about a project, record facts and decisions, keep a daily log, draft and edit notes. Users need a free Vortex Notes account (created in the browser in under a minute). The connector reads and writes data; it can't delete notes.

**5. Company**

vortex-303 · https://vortex-notes.pages.dev · primary contact: your email

**6. Authentication**

Required (OAuth). Method: dynamic client registration (DCR). No client ID or secret to enter.

**7. Data handling**

Our own API (first-party). No personal health data, no sponsored content.

**8. Test & launch · reviewer instructions**

```
Test account (sample notes: Test, Kiln build, Clay notes).
1. Open https://vortex-notes.pages.dev/app → "I already have a phrase" → enter these 12 words: <PASTE FROM ~/vortex-reviewer/identity-output.txt>
2. Add the connector URL https://vortex-notes.pages.dev/mcp. When the Vortex Notes window opens, choose Read + write and click Approve.
3. Try: "What's the launch code in my Test note?" (expects 4417), "Get me up to speed on my kiln project", "Remember that my test bike is blue", "Add to my daily note: reviewed the app".
No MFA, email codes or private network needed. The account holds only sample data.
```

**9. Compliance**

Seven acknowledgements. Nothing applies against us: no payments, no AI media, no conversation-data collection.


## Claude plugin directory
_claude.ai/directory/manage → Submit new → Plugin bundle (after the connector)_ · https://claude.ai/directory/manage

**Repository**

vortex-303/vortex-notes

**Plugin path**

plugins/vortex-notes

**Branch**

main

**Data handling · personal data?**

The plugin itself stores nothing. Its connector reads and writes the user's own notes on vortex-notes.pages.dev (the declared connector). No other destinations.

**Data handling · retention**

None in the plugin. Server retention: see https://vortex-notes.pages.dev/privacy

**Under 18?**

Not intended for children under 13.

**Try it before review**

claude.ai → Customize → Plugins → Add → Add marketplace → vortex-303/vortex-notes


## ChatGPT app directory
_OpenAI platform → Apps / plugins → upload ZIP_ · https://platform.openai.com/

**Before upload**

Verify your OpenAI organization (individual or business) in organization settings.

**ZIP to upload**

Run: ~/vortex-notes/scripts/build-chatgpt-plugin.sh → dist/vortex-notes-chatgpt.zip (name, descriptions, URLs, icons, 5 positive + 3 negative test cases are inside)

**Domain verification**

The portal shows a token. Tell Claude, or run: cd ~/vortex-notes/deploy/cf && npx wrangler secret put OPENAI_APPS_CHALLENGE (paste the token), then redeploy. It's served at https://vortex-notes.pages.dev/.well-known/openai-apps-challenge

**Authentication**

OAuth, dynamic client registration. No client secret.

**Reviewer credentials (dashboard, not the ZIP)**

```
Test account (sample notes: Test, Kiln build, Clay notes).
1. Open https://vortex-notes.pages.dev/app → "I already have a phrase" → enter these 12 words: <PASTE FROM ~/vortex-reviewer/identity-output.txt>
2. Add the connector URL https://vortex-notes.pages.dev/mcp. When the Vortex Notes window opens, choose Read + write and click Approve.
3. Try: "What's the launch code in my Test note?" (expects 4417), "Get me up to speed on my kiln project", "Remember that my test bike is blue", "Add to my daily note: reviewed the app".
No MFA, email codes or private network needed. The account holds only sample data.
```

**Developer identity**

vortex-303

