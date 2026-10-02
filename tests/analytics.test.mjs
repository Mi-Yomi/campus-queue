import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceAnalytics, estimateMinutes, durationLabel } from '../src/queue-analytics.mjs';
test('only positive completed intervals are measured, preserving fractional minutes', () => {
 const ticket = (status, end) => ({ status, calledAt: '2026-10-02T10:00:00Z', finishedAt: end });
 const result = serviceAnalytics([
  ticket('done', '2026-10-02T10:07:00Z'), ticket('done', '2026-10-02T10:05:00Z'),
  ticket('skipped', '2026-10-02T11:00:00Z'), ticket('cancelled', '2026-10-02T11:00:00Z'),
  ticket('done', null), ticket('done', 'bad'), ticket('done', '2026-10-02T10:00:00Z'),
  ticket('done', '2026-10-02T09:59:00Z'), {status:'done'},
 ]);
 assert.deepEqual(result, {sampleCount:2,totalSeconds:720,averageSeconds:360});
 assert.equal(estimateMinutes(2,result),12);
 assert.equal(estimateMinutes(2,{sampleCount:2,averageSeconds:375}),13);
 assert.equal(estimateMinutes(2,serviceAnalytics([])),null);
 assert.equal(estimateMinutes(0,serviceAnalytics([])),0);
 assert.equal(durationLabel(null),'—');
});
