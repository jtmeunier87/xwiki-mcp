// Line-based unified diff (no dependency). Common prefix and suffix are trimmed,
// then the middle is diffed with an LCS table, which suits wiki pages (edits are local).

const MAX_CELLS = 4_000_000;

type Op = { type: ' ' | '-' | '+'; line: string };

export function unifiedDiff(before: string, after: string, context = 3): { diff: string; added: number; removed: number } {
  if (before === after) return { diff: '', added: 0, removed: 0 };
  const a = before.split('\n');
  const b = after.split('\n');

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  const ops: Op[] = a.slice(0, pre).map(line => ({ type: ' ' as const, line }));
  if ((am.length + 1) * (bm.length + 1) > MAX_CELLS) {
    // Too large to align line by line: show the changed block as removed then added.
    ops.push(...am.map(line => ({ type: '-' as const, line })), ...bm.map(line => ({ type: '+' as const, line })));
  } else {
    ops.push(...lcsOps(am, bm));
  }
  ops.push(...a.slice(a.length - suf).map(line => ({ type: ' ' as const, line })));

  return {
    diff: formatHunks(ops, context),
    added: ops.filter(o => o.type === '+').length,
    removed: ops.filter(o => o.type === '-').length,
  };
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // len[i * w + j] = LCS length of a[i..] and b[j..]
  const len = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = a[i] === b[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: ' ', line: a[i] }); i++; j++; }
    else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) { ops.push({ type: '-', line: a[i] }); i++; }
    else { ops.push({ type: '+', line: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: '-', line: a[i++] });
  while (j < m) ops.push({ type: '+', line: b[j++] });
  return ops;
}

function formatHunks(ops: Op[], context: number): string {
  const out: string[] = [];
  let k = 0;
  // Line numbers (1-based) in the old and new text at ops[k].
  let oldLine = 1;
  let newLine = 1;
  while (k < ops.length) {
    if (ops[k].type === ' ') {
      oldLine++; newLine++; k++;
      continue;
    }
    // A hunk: from `context` lines before this change to `context` lines after the last
    // change that is within 2 * context lines of the previous one.
    const startK = Math.max(0, k - context);
    let endK = k;
    let gap = 0;
    for (let x = k; x < ops.length; x++) {
      if (ops[x].type === ' ') {
        gap++;
        if (gap > 2 * context) break;
      } else {
        gap = 0;
        endK = x;
      }
    }
    endK = Math.min(ops.length - 1, endK + context);
    const back = k - startK;
    const o = oldLine - back;
    const n = newLine - back;
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let x = startK; x <= endK; x++) {
      const op = ops[x];
      lines.push(op.type + op.line);
      if (op.type !== '+') oldCount++;
      if (op.type !== '-') newCount++;
    }
    out.push(`@@ -${o},${oldCount} +${n},${newCount} @@`, ...lines);
    // Advance counters past the hunk.
    for (let x = k; x <= endK; x++) {
      if (ops[x].type !== '+') oldLine++;
      if (ops[x].type !== '-') newLine++;
    }
    k = endK + 1;
  }
  return out.join('\n');
}
