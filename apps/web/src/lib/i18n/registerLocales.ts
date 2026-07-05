// Side-effect-only import barrel: each line loads a locale's assembler module, which
// registers itself into locale.svelte.ts's registry via registerLocale(). Imported once from
// App.svelte (the app root) — NOT from locale.svelte.ts itself, which would create a circular
// import (each assembler imports registerLocale FROM locale.svelte.ts).
import "./fr.js";
import "./ja.js";
import "./ko.js";
import "./es.js";
import "./pl.js";
