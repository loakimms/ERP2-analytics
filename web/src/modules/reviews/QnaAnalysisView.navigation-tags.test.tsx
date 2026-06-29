import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	clickWithAct,
	mockedAxios,
	registerQnaAnalysisTestLifecycle,
	renderQnaAnalysisView,
} from './QnaAnalysisView.testUtils';
import { QnaAnalysisView } from './QnaAnalysisView';

describe('QnaAnalysisView navigation/tags', () => {
	registerQnaAnalysisTestLifecycle();

	it('선택한 이슈 태그를 Q&A 관리 화면 deep link에 함께 전달한다', async () => {
		const navigateSpy = vi.fn();

		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" onNavigate={navigateSpy} />);

		await clickWithAct(await screen.findByRole('button', { name: '품질/불만 분석' }));
		await clickWithAct(screen.getByRole('button', { name: '이슈 태그 색상 1건' }));
		await clickWithAct(screen.getAllByRole('button', { name: 'Q&A 관리에서 보기' })[0]!);

		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('issue_tag=%EC%83%89%EC%83%81'));
	});

	it('URL 초기 컨텍스트를 읽어 분석 섹션과 이슈 태그 필터를 복원한다', async () => {
		window.history.replaceState(
			{},
			'',
			'/analytics/reviews/qna-analysis?qna_kind=product&search=%ED%85%8C%EC%8A%A4%ED%8A%B8&from_date=2026-04-01&to_date=2026-04-07&issue_tag=%EC%83%89%EC%83%81&section=quality&response_state=rejected',
		);

		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('관리 상태 컨텍스트: 반려')).toBeTruthy();
		expect(await screen.findByText('선택된 이슈 태그: 색상')).toBeTruthy();
		expect(screen.getByText('색상이 사진과 많이 다릅니다.')).toBeTruthy();
		expect(screen.queryByText('냄새가 너무 강하고 따갑습니다.')).toBeNull();

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenCalledWith(
				'http://localhost:5189/qna/analysis/summary',
				expect.objectContaining({
					params: expect.objectContaining({
						qna_kind: 'product',
						search: '테스트',
						from_date: '2026-04-01',
						to_date: '2026-04-07',
					}),
				}),
			);
		});
	});

	it('이슈 태그는 표시 라벨과 레거시 코드가 섞여 와도 중복 없이 보여준다', async () => {
		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" />);

		await clickWithAct(await screen.findByRole('button', { name: '원문 검색/개별 문의 분석' }));
		expect(await screen.findByText('구매 직전 지속력 확인 문의')).toBeTruthy();
		const issueTagRow = screen.getByText('이슈 태그').closest('.qna-analysis-detail-row');
		expect(issueTagRow?.textContent || '').toContain('냄새');
		expect(screen.queryByText('ODOR')).toBeNull();
		expect(screen.queryByText('냄새, 냄새')).toBeNull();
	});

	it('이슈 태그 집계 칩으로 품질/원문 화면을 함께 필터링하고 해제할 수 있다', async () => {
		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" />);

		await clickWithAct(await screen.findByRole('button', { name: '품질/불만 분석' }));
		expect(await screen.findByText('냄새가 너무 강하고 따갑습니다.')).toBeTruthy();
		expect(screen.getByText('색상이 사진과 많이 다릅니다.')).toBeTruthy();
		expect(screen.getByRole('button', { name: '이슈 태그 냄새 1건' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '이슈 태그 색상 1건' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '이슈 태그 색상 1건' }));
		expect(screen.getByText('선택된 이슈 태그: 색상')).toBeTruthy();
		expect(screen.queryByText('냄새가 너무 강하고 따갑습니다.')).toBeNull();
		expect(screen.getByText('색상이 사진과 많이 다릅니다.')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '원문 검색/개별 문의 분석' }));
		expect(await screen.findByText('구매 후 색상 차이 불만 문의')).toBeTruthy();
		expect(screen.queryByText('구매 직전 지속력 확인 문의')).toBeNull();

		await clickWithAct(screen.getByRole('button', { name: '이슈 태그 전체 보기 2건' }));
		expect(screen.queryByText('선택된 이슈 태그: 색상')).toBeNull();
		expect(await screen.findByText('구매 직전 지속력 확인 문의')).toBeTruthy();
	});
});
