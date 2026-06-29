import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerQnaAnalysisTestLifecycle,
	renderQnaAnalysisView,
} from './QnaAnalysisView.testUtils';
import { QnaAnalysisView } from './QnaAnalysisView';

describe('QnaAnalysisView dashboard', () => {
	registerQnaAnalysisTestLifecycle();

	it('전문가 분석 허브를 렌더링하고 섹션 전환 및 분석 실행을 지원한다', async () => {
		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('Q&A 전문가 분석')).toBeTruthy();
		expect(screen.getByText('활용 가이드')).toBeTruthy();
		expect(screen.getByText('FAQ 먼저 보강')).toBeTruthy();
		expect(screen.getByText(/지속력과 안전성 질문을 FAQ와 상세페이지 상단에 반영하세요\./)).toBeTruthy();
		expect(screen.getAllByText('높음').length).toBeGreaterThan(0);
		expect(screen.getByText('총 문의')).toBeTruthy();
		expect(screen.getByText('12건')).toBeTruthy();
		expect(screen.getByLabelText('Q&A 일별 추이 그래프')).toBeTruthy();
		expect(screen.getByText('04.01')).toBeTruthy();
		expect(screen.getAllByText('긍정').length).toBeGreaterThan(0);
		expect(screen.getByRole('table', { name: '상품별 우선순위 표' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '문의 현황 요약' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '전환 장애 분석' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '원문 검색/개별 문의 분석' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '전환 장애 분석' }));
		expect(await screen.findByText('얼마나 지속되나요?')).toBeTruthy();
		expect(screen.getByText('FAQ와 상세페이지 지속력 섹션을 강화하세요.')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '품질/불만 분석' }));
		expect(await screen.findByText('냄새가 너무 강하고 따갑습니다.')).toBeTruthy();
		expect(screen.getByText('냄새, 자극')).toBeTruthy();
		expect(screen.getAllByText('높음').length).toBeGreaterThan(0);

		await clickWithAct(screen.getByRole('button', { name: 'FAQ/상세페이지 개선' }));
		expect(await screen.findByText('민감한 두피도 사용 가능한가요?')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '마케팅/광고 인사이트' }));
		expect(await screen.findByText('민감성 두피')).toBeTruthy();
		expect(screen.getByText(/상세페이지 첫 화면/)).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '원문 검색/개별 문의 분석' }));
		expect(await screen.findByText('구매 직전 지속력 확인 문의')).toBeTruthy();
		expect(screen.getByText('FAQ 등록')).toBeTruthy();
		expect(screen.getAllByText('중립').length).toBeGreaterThan(0);
		expect(screen.getByText('냄새')).toBeTruthy();

		await changeWithAct(screen.getByPlaceholderText('상품명 필터'), { target: { value: '테스트 샴푸' } });
		await changeWithAct(screen.getByPlaceholderText('카테고리 필터'), { target: { value: '효과' } });
		const comboBoxes = screen.getAllByRole('combobox');
		await changeWithAct(comboBoxes[1]!, { target: { value: '효과문의' } });
		await changeWithAct(comboBoxes[4]!, { target: { value: 'HIGH' } });
		await clickWithAct(screen.getByRole('button', { name: '필터 적용' }));

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenCalledWith(
				'http://localhost:5189/qna/analysis/summary',
				expect.objectContaining({
					params: expect.objectContaining({
						product_name: '테스트 샴푸',
						category: '효과',
						inquiry_type: '효과문의',
						conversion_level: 'HIGH',
					}),
				}),
			);
		});

		await clickWithAct(screen.getByRole('button', { name: '분석 실행' }));
		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/analysis/run',
				expect.objectContaining({ force_reanalyze: false }),
				{ headers: { Authorization: 'Bearer test-token' } },
			);
		});
	});

	it('기간 추이 그래프 hover 시 날짜와 값을 툴팁으로 보여준다', async () => {
		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" />);

		const chart = await screen.findByLabelText('Q&A 일별 추이 그래프');
		Object.defineProperty(chart, 'getBoundingClientRect', {
			value: () => ({
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				right: 720,
				bottom: 240,
				width: 720,
				height: 240,
				toJSON: () => ({}),
			}),
		});
		expect(screen.queryByText('전체 문의 3건')).toBeNull();
		fireEvent.mouseMove(chart, { clientX: 26, clientY: 120 });

		expect(await screen.findByText('2026-04-01')).toBeTruthy();
		expect(screen.getByText('전체 문의 3건')).toBeTruthy();
		expect(screen.getByText('부정 문의 1건')).toBeTruthy();
		expect(screen.getByText('FAQ 후보 1건')).toBeTruthy();

		const tooltip = screen.getByText('2026-04-01').closest('.qna-analysis-trend-tooltip');
		expect(tooltip).toBeTruthy();
		expect((tooltip as HTMLElement).style.left).not.toBe('');
	});

	it('활용 가이드에서 관련 섹션 이동과 Q&A 관리 연계를 제공한다', async () => {
		const navigateSpy = vi.fn();

		await renderQnaAnalysisView(<QnaAnalysisView apiBaseUrl="http://localhost:5189" onNavigate={navigateSpy} />);

		expect(await screen.findByText('FAQ 먼저 보강')).toBeTruthy();
		await clickWithAct(screen.getAllByRole('button', { name: '관련 섹션 보기' })[0]!);
		expect(await screen.findByText('민감한 두피도 사용 가능한가요?')).toBeTruthy();

		await clickWithAct(screen.getAllByRole('button', { name: 'Q&A 관리에서 보기' })[0]!);
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('/analytics/reviews/qna?'));
	});
});
