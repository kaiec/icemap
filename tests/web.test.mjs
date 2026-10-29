// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { ic, iic, squarify } from '../web/icemap.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('IC is 0 at the root and 1 for an unused concept (Eq. 2.7)', () => {
  close(ic(9, 9), 0);
  close(ic(0, 9), 1);
});

test('the example of Figure 2.2: D(B) = -0.11', () => {
  // B: w_f+ = 5 of 9, w_e+ = 3 of 7
  const d = ic(5, 9) - ic(3, 7);
  close(Math.round(ic(5, 9) * 100) / 100, 0.22, 1e-9);
  close(Math.round(ic(3, 7) * 100) / 100, 0.33, 1e-9);
  close(Math.round(d * 100) / 100, -0.11, 1e-9);
});

test('IIC from the subtree size', () => {
  close(iic(10, 10), 0);
  close(iic(1, 10), 1);
});

test('squarify fills the rectangle with areas in proportion (Bruls et al., Fig. 2.4)', () => {
  const v = [6, 6, 4, 3, 2, 2, 1];
  const r = squarify(v, 0, 0, 6, 4);
  const total = r.reduce((s, [, , w, h]) => s + w * h, 0);
  close(total, 24, 1e-6);
  r.forEach(([, , w, h], k) => close(w * h, v[k], 1e-6));
  for (const [x, y, w, h] of r) assert.ok(x >= -1e-9 && y >= -1e-9 && x + w <= 6 + 1e-9 && y + h <= 4 + 1e-9);
  // the first row of the paper's example holds the two 6s, each 3 x 2
  close(r[0][2], 3, 1e-6); close(r[0][3], 2, 1e-6);
});
