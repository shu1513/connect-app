// Starts the open-source checker's thread (own-thread.ts). A plain file on purpose: the thread
// then starts the same way whatever started the helper, and on any version of Node.
import { tsImport } from "tsx/esm/api";

await tsImport("./own-thread.ts", import.meta.url);
