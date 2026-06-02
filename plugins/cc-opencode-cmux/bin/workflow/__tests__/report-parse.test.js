import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport } from '../report-parse.js';

const SAMPLE = `status:   done
session:  /tmp/oc/s1
oc_sid:   ses_abc123
files:    +12 -3 (4 files)
diff:     /tmp/oc/s1/diff.patch
done:     0 session idle
notes:    `;

test('parseReport extracts fields', () => {
  const r = parseReport(SAMPLE);
  assert.equal(r.status, 'done');
  assert.equal(r.session, '/tmp/oc/s1');
  assert.equal(r.oc_sid, 'ses_abc123');
  assert.equal(r.add, 12);
  assert.equal(r.del, 3);
  assert.equal(r.files, 4);
  assert.equal(r.diff, '/tmp/oc/s1/diff.patch');
});

test('parseReport handles missing fields gracefully', () => {
  const r = parseReport('status:   error\nnotes:    boom');
  assert.equal(r.status, 'error');
  assert.equal(r.add, 0);
  assert.equal(r.files, 0);
  assert.equal(r.notes, 'boom');
});
