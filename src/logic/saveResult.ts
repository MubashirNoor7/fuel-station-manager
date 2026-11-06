// Result of a save that goes to the database.
// `ok: true`  -> the database confirmed the save.
// `ok: false` -> nothing was saved; `error` says why.
// (Kept as a plain shape, not a discriminated union, because this project does not use strict mode
//  and TypeScript cannot narrow a union on `ok` without it.)
export type SaveResult = { ok: boolean; error?: string };

export const saveErrorText = (result: SaveResult) => result.error || 'Unknown error while saving.';
