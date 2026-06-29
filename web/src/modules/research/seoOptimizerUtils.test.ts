import { describe, it, expect } from 'vitest';
import {
	buildConversionTemplateCombo,
	buildLiveCombos,
	buildTokenMetrics,
	buildVocabTokens,
	buildSynonymIndex,
	computeComboStats,
	computeScoresV2,
	expandCompoundKeywordForSelection,
	isCapacityLikeToken,
	filterCandidates,
	segmentKoreanCompound,
	type CandidateLike,
} from './seoOptimizerUtils';

describe('seoOptimizerUtils', () => {
	it('segmentKoreanCompound: vocab 기반으로 조합키워드를 분해한다(천연헤나염색약)', () => {
		const vocab = buildVocabTokens({
			titleTokens: [
				{ token: '천연', freq: 10 },
				{ token: '헤나', freq: 10 },
				{ token: '염색약', freq: 10 },
			],
		});
		expect(segmentKoreanCompound('천연헤나염색약', vocab)).toEqual(['천연', '헤나', '염색약']);
	});

	it('computeScoresV2: 검색량>빈도>CTR 가중치로 total이 계산된다', () => {
		const list: CandidateLike[] = [
			{ keyword: 'A', totalSearchQcCnt: 1000, titleFreq: 1, avgCtr: 1 },
			{ keyword: 'B', totalSearchQcCnt: 10, titleFreq: 100, avgCtr: 10 },
		];
		const scored = computeScoresV2(list, { search: 0.6, freq: 0.3, ctr: 0.1 });
		const a = scored.find((x) => x.keyword === 'A')!;
		const b = scored.find((x) => x.keyword === 'B')!;
		// A는 검색량이 압도적으로 높으므로 total이 더 높아야 한다.
		expect(a.scoresV2.total).toBeGreaterThan(b.scoresV2.total);
	});

	it('filterCandidates: includeText + 범위 필터가 동작한다', () => {
		const list: CandidateLike[] = [
			{ keyword: '염색약', totalSearchQcCnt: 5000, titleFreq: 10, avgCtr: 2.0, compIdx: '높음' },
			{ keyword: '헤나염색', totalSearchQcCnt: 800, titleFreq: 1, avgCtr: 10.0, compIdx: '중간' },
		];
		const filtered = filterCandidates(list, { includeText: '염색', minSearch: 1000, competition: '높음' });
		expect(filtered.map((x) => x.keyword)).toEqual(['염색약']);
	});

	it('computeComboStats: SearchAd 지표가 없으면 검색합/CTR은 null로 처리(0으로 표시하지 않음)', () => {
		const stats = computeComboStats({
			comboTokens: ['prefix', '천연', '유기농'],
			prefix: 'prefix',
			tokenMetrics: {
				천연: { token: '천연', search: 0, freq: 10, ctr: 0 },
				유기농: { token: '유기농', search: 0, freq: 9, ctr: 0 },
			},
			metricBounds: { sMin: 0, sMax: 0, fMin: 0, fMax: 10, cMin: 0, cMax: 0 },
			weights: { search: 0.6, freq: 0.3, ctr: 0.1 },
		});
		expect(stats).toBeTruthy();
		expect(stats!.totalSearch).toBeNull();
		expect(stats!.avgCtr).toBeNull();
		expect(stats!.totalFreq).toBe(19);
		// search/ctr 축은 가용하지 않으므로 freq 기반으로만 점수가 계산된다
		expect(stats!.totalScore).not.toBeNull();
	});

	it('buildLiveCombos: 선택 단어 기준으로 prefix + 최대 토큰 제한을 지킨 조합을 만든다', () => {
		const cands = [
			{ keyword: '천연헤나염색약', totalSearchQcCnt: 5000, titleFreq: 5, avgCtr: 2, tokens: ['천연', '헤나', '염색약'] },
			{ keyword: '새치', totalSearchQcCnt: 3000, titleFreq: 8, avgCtr: 1, tokens: ['새치'] },
		];
		const metrics = buildTokenMetrics(cands);
		const combos = buildLiveCombos({
			productName: '수자타 헤나',
			mainKeyword: '헤나 염색약',
			selectedTokens: ['염색약', '새치', '천연'],
			tokenMetrics: metrics,
			maxTokensTotal: 5,
			maxChars: 25,
			rules: {
				stopwords: ['무료배송'],
				synonymGroups: [['염색약', '염색', '염색제']],
				maxChars: 25,
			},
			comboCount: 10,
		});
		expect(combos.length).toBeGreaterThan(0);
		// prefix 포함
		expect(combos[0]!.name.startsWith('수자타 헤나')).toBeTruthy();
		// 최대 토큰 제한
		for (const c of combos) expect(c.tokens.length).toBeLessThanOrEqual(5);
	});

	it('buildSynonymIndex: 동의어 그룹은 대표어로 정규화된다', () => {
		const idx = buildSynonymIndex([['염색약', '염색', '염색제']]);
		expect(idx.toCanonical['염색']).toBe('염색약');
		expect(idx.toCanonical['염색제']).toBe('염색약');
	});

	it('buildConversionTemplateCombo: 6슬롯 템플릿(메인1+구매의도2+안전/차별2+형태1)을 25자/토큰 제한으로 강제한다', () => {
		const ok = buildConversionTemplateCombo({
			// 6슬롯이라 25자 제한을 쉽게 넘기므로, 성공 케이스는 짧은 prefix/짧은 토큰으로 구성
			productName: '수자타',
			mainToken: '염색약',
			intentToken1: '구매',
			intentToken2: '즉시',
			safetyToken1: '순한',
			safetyToken2: '천연',
			formToken: '크림',
			maxTokensTotal: 8,
			maxChars: 25,
			rules: { stopwords: ['무료배송'], synonymGroups: [['염색약', '염색', '염색제']], maxChars: 25 },
		});
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.name.startsWith('수자타')).toBeTruthy();
			// 순서: prefix + 메인 + 구매1 + 구매2 + 안전1 + 안전2 + 형태
			expect(ok.name).toContain('염색약 구매 즉시 순한 천연 크림');
			expect(ok.name.length).toBeLessThanOrEqual(25);
		}

		const bad = buildConversionTemplateCombo({
			productName: '수자타 헤나',
			mainToken: '염색 약', // 단일 키워드 위반
			intentToken1: '구매',
			intentToken2: '추천',
			safetyToken1: '저자극',
			safetyToken2: '천연',
			formToken: '크림',
			maxTokensTotal: 8,
			maxChars: 25,
			rules: { stopwords: [], synonymGroups: [], maxChars: 25 },
		});
		expect(bad.ok).toBe(false);
	});

	it('expandCompoundKeywordForSelection: 조합형(무공백) 키워드는 앞 토큰 + 원문으로 노출한다', () => {
		expect(
			expandCompoundKeywordForSelection({
				keyword: '헤나염색약',
				segmentedTokens: ['헤나', '염색약'],
			}),
		).toEqual(['헤나', '헤나염색약']);
	});

	it('isCapacityLikeToken: 용량/수량 토큰은 true', () => {
		expect(isCapacityLikeToken('100g')).toBe(true);
		expect(isCapacityLikeToken('30 g')).toBe(true);
		expect(isCapacityLikeToken('200ml')).toBe(true);
		expect(isCapacityLikeToken('200 mL')).toBe(true);
		expect(isCapacityLikeToken('1L')).toBe(true);
		expect(isCapacityLikeToken('0.5kg')).toBe(true);
		expect(isCapacityLikeToken('1개')).toBe(true);
		expect(isCapacityLikeToken('2개입')).toBe(true);
		expect(isCapacityLikeToken('10매')).toBe(true);
		expect(isCapacityLikeToken('100g*2')).toBe(true);
	});

	it('isCapacityLikeToken: 일반 키워드는 false', () => {
		expect(isCapacityLikeToken('헤나')).toBe(false);
		expect(isCapacityLikeToken('염색약')).toBe(false);
		expect(isCapacityLikeToken('100')).toBe(false);
	});
});


