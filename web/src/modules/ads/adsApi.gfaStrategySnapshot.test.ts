import axios from 'axios';
import { describe, expect, it } from 'vitest';

import {
	gfaStrategyPayloadFromSnapshot,
	isNoPublishedGfaStrategySnapshotError,
	type GfaStrategyLatestSnapshot,
} from './adsApi';

describe('gfa strategy snapshot API helpers', () => {
	it('maps snapshot.payload as the strategy screen authority and fills period fallbacks', () => {
		const snapshot: GfaStrategyLatestSnapshot = {
			ok: true,
			snapshot_id: 'snap-1',
			status: 'PUBLISHED',
			as_of_date: '2026-09-18',
			period: { start: '2024-01-01', end: '2026-09-18' },
			published_at: '2026-09-19T06:31:00+09:00',
			payload: {
				ok: true,
				date_from: '',
				date_to: '',
				executive_summary: ['기간 핵심 결론'],
			},
		};
		expect(gfaStrategyPayloadFromSnapshot(snapshot)).toEqual({
			ok: true,
			date_from: '2024-01-01',
			date_to: '2026-09-18',
			executive_summary: ['기간 핵심 결론'],
		});
	});

	it('detects NO_PUBLISHED_STRATEGY_SNAPSHOT without treating other errors as empty', () => {
		const emptyErr = {
			isAxiosError: true,
			response: { status: 404, data: { detail: 'NO_PUBLISHED_STRATEGY_SNAPSHOT' } },
		};
		const otherErr = {
			isAxiosError: true,
			response: { status: 500, data: { detail: 'boom' } },
		};
		expect(axios.isAxiosError(emptyErr)).toBe(true);
		expect(isNoPublishedGfaStrategySnapshotError(emptyErr)).toBe(true);
		expect(isNoPublishedGfaStrategySnapshotError(otherErr)).toBe(false);
		expect(isNoPublishedGfaStrategySnapshotError(new Error('network'))).toBe(false);
	});
});
