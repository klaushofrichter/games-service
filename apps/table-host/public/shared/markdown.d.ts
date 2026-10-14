// Types for markdown.js (a browser module, plain JavaScript like the rest of public/), so the tests are typechecked.
/** Render a game's rules Markdown; images resolve against `base` ("/games/<id>/"). */
export function renderRules(md: string, base?: string): { title: string; html: string };
