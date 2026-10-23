// Targeted text edits for xwiki_edit_page: each old text must occur exactly once.

export interface TextEdit {
  old_text: string;
  new_text: string;
}

export interface EditChange {
  /** 1-based line where the replaced text started, in the text as it was before this edit. */
  line: number;
  old_text: string;
  new_text: string;
}

export class EditError extends Error {}

const PREVIEW = 200;

const preview = (s: string) => (s.length > PREVIEW ? `${s.slice(0, PREVIEW)}…` : s);

/**
 * Apply the edits in order, each to the result of the one before.
 * All or nothing: throws EditError if any old text is empty, missing or not unique.
 */
export function applyEdits(text: string, edits: TextEdit[]): { text: string; changes: EditChange[] } {
  if (edits.length === 0) throw new EditError('Give at least one edit.');
  let out = text;
  const changes: EditChange[] = [];
  edits.forEach((e, i) => {
    const n = edits.length > 1 ? `Edit ${i + 1}: ` : '';
    if (e.old_text === '') throw new EditError(`${n}old_text is empty.`);
    if (e.old_text === e.new_text) throw new EditError(`${n}old_text and new_text are the same.`);
    const at = out.indexOf(e.old_text);
    if (at < 0) {
      throw new EditError(
        `${n}old_text was not found${i > 0 ? ' (after the earlier edits)' : ''}. ` +
          'It must match exactly, including spaces, indentation and line breaks; read the text again and copy it.',
      );
    }
    const count = out.split(e.old_text).length - 1;
    if (count > 1) {
      throw new EditError(`${n}old_text occurs ${count} times. Include more of the surrounding text so it matches once.`);
    }
    changes.push({ line: out.slice(0, at).split('\n').length, old_text: preview(e.old_text), new_text: preview(e.new_text) });
    out = out.slice(0, at) + e.new_text + out.slice(at + e.old_text.length);
  });
  return { text: out, changes };
}
