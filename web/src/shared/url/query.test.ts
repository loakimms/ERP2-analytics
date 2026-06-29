import { describe, expect, it } from 'vitest';
import { buildPathWithQuery, readQueryParam, serializeQueryParams } from './query';

describe('shared/url/query', () => {
	it('배열과 빈 값을 제외해 query string을 직렬화한다', () => {
		expect(
			serializeQueryParams({
				qna_kind: 'product',
				issue_tag: '',
				rating_filters: ['5', '4', '', null],
				limit: 200,
				unused: undefined,
			}),
		).toBe('qna_kind=product&rating_filters=5&rating_filters=4&limit=200');
	});

	it('path와 query를 안전하게 결합한다', () => {
		expect(
			buildPathWithQuery('/analytics/reviews/qna', {
				qna_kind: 'all',
				from_date: '2026-04-01',
				to_date: '2026-04-07',
				issue_tag: '냄새',
			}),
		).toBe('/analytics/reviews/qna?qna_kind=all&from_date=2026-04-01&to_date=2026-04-07&issue_tag=%EB%83%84%EC%83%88');
	});

	it('search에서 단일 파라미터를 읽는다', () => {
		expect(readQueryParam('?action_bucket=BUDGET_INCREASE', 'action_bucket')).toBe('BUDGET_INCREASE');
		expect(readQueryParam('?action_bucket=BUDGET_INCREASE', 'missing')).toBe('');
	});
});
