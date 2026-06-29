import React, { useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
	addDays,
	addMonths,
	endOfMonth,
	endOfWeek,
	// NOTE: 날짜 이동은 dateRangeUtils의 rangeLengthDays를 사용한다.
	format,
	startOfMonth,
	startOfWeek,
	subDays,
	subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale/ko';
import {
	addRangeDays,
	defaultYesterdayRange,
	normalizeRange,
	rangeLengthDays,
	shiftRange,
	toLocalStartOfDay,
	toYmd,
	type CompareMode,
	type DateRange,
} from './dateRangeUtils';

export type AdsDateState = {
	range: DateRange;
	compareMode: CompareMode;
};

export const ADS_DATESTATE_LS_KEY = 'ads.dateState.v1';

// 달력 월/요일 표기를 한글로
registerLocale('ko', ko);

function formatDotDate(d: Date): string {
	const x = toLocalStartOfDay(d);
	const y = x.getFullYear();
	const m = String(x.getMonth() + 1).padStart(2, '0');
	const dd = String(x.getDate()).padStart(2, '0');
	return `${y}.${m}.${dd}.`;
}

function formatRangeLabel(r: DateRange): string {
	const rr = normalizeRange(r);
	return `${formatDotDate(rr.from)} ~ ${formatDotDate(rr.to)}`;
}

export function loadAdsDateState(): AdsDateState {
	try {
		const raw = localStorage.getItem(ADS_DATESTATE_LS_KEY);
		if (!raw) throw new Error('no');
		const j = JSON.parse(raw) as any;
		const from = j?.range?.from ? new Date(String(j.range.from)) : null;
		const to = j?.range?.to ? new Date(String(j.range.to)) : null;
		const compareMode = String(j?.compareMode || 'prev_day') as CompareMode;
		if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
			throw new Error('bad');
		}
		const r = normalizeRange({ from, to });
		return { range: r, compareMode: compareMode || 'prev_day' };
	} catch {
		return { range: defaultYesterdayRange(), compareMode: 'prev_day' };
	}
}

export function saveAdsDateState(s: AdsDateState) {
	try {
		localStorage.setItem(
			ADS_DATESTATE_LS_KEY,
			JSON.stringify({
				range: { from: s.range.from.toISOString(), to: s.range.to.toISOString() },
				compareMode: s.compareMode,
			}),
		);
	} catch {
		// ignore
	}
}

type Props = {
	value?: AdsDateState;
	onChange: (next: AdsDateState) => void;
};

export function AdsDateControls(props: Props): JSX.Element {
	const [open, setOpen] = useState(false);
	const value = props.value ?? loadAdsDateState();

	const [draft, setDraft] = useState<AdsDateState>(() => value);
	const [draftStart, setDraftStart] = useState<Date>(() => normalizeRange(value.range).from);
	const [draftEnd, setDraftEnd] = useState<Date | null>(() => normalizeRange(value.range).to);

	const now = useMemo(() => new Date(), []);
	const today = useMemo(() => toLocalStartOfDay(now), [now]);

	// 달력 월(뷰) 상태를 분리:
	// - 좌측: 시작일 선택 달력
	// - 우측: 종료일 선택 달력
	// 요구사항: 우측 달 이동 시 좌측 달력은 고정
	const [startViewMonth, setStartViewMonth] = useState<Date>(() => {
		const r = normalizeRange(value.range);
		return startOfMonth(r.from);
	});
	const [endViewMonth, setEndViewMonth] = useState<Date>(() => {
		const r = normalizeRange(value.range);
		return startOfMonth(r.to);
	});

	const draftLabel = useMemo(() => {
		const s = toYmd(draftStart);
		const e = toYmd(draftEnd ?? draftStart);
		return draftEnd ? `${s} ~ ${e}` : `${s} ~ ${e} (종료일 선택중)`;
	}, [draftStart, draftEnd]);

	const toggleOpen = () => {
		const next = !open;
		setOpen(next);
		if (next) {
			const r = normalizeRange(value.range);
			setDraft(value);
			setDraftStart(r.from);
			setDraftEnd(r.to);
			// 기본 UX:
			// - 우측(종료) 달력은 종료일의 월
			// - 좌측(시작) 달력은 시작일의 월(단, 동일 월이면 "전월"로 보여줘 2달을 항상 노출)
			const endM = startOfMonth(r.to);
			const startM = startOfMonth(r.from);
			setEndViewMonth(endM);
			setStartViewMonth(startM.getTime() === endM.getTime() ? startOfMonth(subMonths(endM, 1)) : startM);
		}
	};

	const apply = () => {
		const from = draftStart ? toLocalStartOfDay(draftStart) : normalizeRange(draft.range).from;
		const to = toLocalStartOfDay(draftEnd ?? draftStart ?? normalizeRange(draft.range).to);
		const next = { ...draft, range: normalizeRange({ from, to }) };
		props.onChange(next);
		saveAdsDateState(next);
		setOpen(false);
	};

	const cancel = () => {
		setDraft(value);
		const r = normalizeRange(value.range);
		setDraftStart(r.from);
		setDraftEnd(r.to);
		setOpen(false);
	};

	const setPresetRange = (r: DateRange) => {
		const rr = normalizeRange(r);
		setDraft((prev) => ({ ...prev, range: rr }));
		setDraftStart(rr.from);
		setDraftEnd(rr.to);
		// 프리셋 선택 시 달력도 즉시 해당 기간이 보이도록 뷰 월을 갱신한다.
		const endM = startOfMonth(rr.to);
		const startM = startOfMonth(rr.from);
		setEndViewMonth(endM);
		setStartViewMonth(startM.getTime() === endM.getTime() ? startOfMonth(subMonths(endM, 1)) : startM);
	};

	// 요구사항: 좌/우 이동은 "선택된 기간 길이"만큼 통째로 이동한다.
	// 예: 7일 기간 -> 7일 이동, 30일 기간 -> 30일 이동
	const shiftByPeriod = (dir: -1 | 1) => {
		const r = normalizeRange(value.range);
		const len = Math.max(1, rangeLengthDays(r));
		const next = addRangeDays(r, dir * len);
		const st = { ...value, range: next };
		props.onChange(st);
		saveAdsDateState(st);
	};

	const compareLabel = useMemo(() => {
		const cr = normalizeRange(value.range);
		const pr = shiftRange(cr, value.compareMode);
		const unit =
			value.compareMode === 'prev_day' ? '전일(이전 동일기간)' :
			value.compareMode === 'prev_week' ? '전주(7일 전)' :
			'전달(1개월 전)';
		return `${unit} · 비교기간: ${formatRangeLabel(pr)}`;
	}, [value.range, value.compareMode]);

	return (
		<div className="ads-controls">
			<div className="ads-controls-left">
				<div className="ads-controls-title">기간</div>
				<div className="ads-controls-sub">{compareLabel}</div>
			</div>

			<div className="ads-controls-right">
				<button type="button" className="btn-ghost ads-nav-btn" onClick={() => shiftByPeriod(-1)} title="이전 기간">
					‹
				</button>

				<button
					type="button"
					className="ads-range-btn"
					onClick={toggleOpen}
					aria-label="date-range"
				>
					{(() => {
						const r = normalizeRange(value.range);
						const labelPrefix =
							r.from.getTime() === subDays(today, 1).getTime() && r.to.getTime() === subDays(today, 1).getTime()
								? '어제'
								: r.from.getTime() === today.getTime() && r.to.getTime() === today.getTime()
									? '오늘'
									: '기간';
						return `${labelPrefix}: ${formatRangeLabel(r)}`;
					})()}
				</button>

				<button type="button" className="btn-ghost ads-nav-btn" onClick={() => shiftByPeriod(1)} title="다음 기간">
					›
				</button>

				<select
					className="ads-compare-select"
					value={draft.compareMode}
					onChange={(e) => {
						const v = String(e.target.value) as CompareMode;
						setDraft((prev) => ({ ...prev, compareMode: v }));
						// 열려있지 않은 상태에서도 즉시 반영(UX)
						if (!open) {
							const next = { ...value, compareMode: v };
							props.onChange(next);
							saveAdsDateState(next);
						}
					}}
					title="비교 기준"
				>
					<option value="prev_day">전일</option>
					<option value="prev_week">전주</option>
					<option value="prev_month">전달</option>
				</select>
			</div>

			{open && (
				<div className="ads-range-popover" role="dialog" aria-label="기간 선택">
					<div className="ads-range-popover-body">
						<div className="ads-presets">
							<div className="ads-presets-col">
								<div className="ads-presets-title">빠른 선택</div>
								<div className="ads-presets-grid">
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: today, to: today })}>오늘</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange(defaultYesterdayRange(today))}>어제</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfWeek(today, { weekStartsOn: 1 }), to: today })}>이번 주</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfWeek(subDays(today, 7), { weekStartsOn: 1 }), to: endOfWeek(subDays(today, 7), { weekStartsOn: 1 }) })}>지난 주</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfMonth(today), to: today })}>이번 달</button>
									<button type="button" className="ads-preset" onClick={() => {
										const m = subMonths(today, 1);
										setPresetRange({ from: startOfMonth(m), to: endOfMonth(m) });
									}}>지난 달</button>
								</div>
							</div>
							<div className="ads-presets-col">
								<div className="ads-presets-title">최근</div>
								<div className="ads-presets-grid">
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 6), to: today })}>최근 7일(오늘 포함)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 7), to: subDays(today, 1) })}>최근 7일(오늘 제외)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 29), to: today })}>최근 30일(오늘 포함)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 30), to: subDays(today, 1) })}>최근 30일(오늘 제외)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 59), to: today })}>최근 60일</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 89), to: today })}>최근 90일</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 179), to: today })}>최근 180일</button>
									<button
										type="button"
										className="ads-preset"
										onClick={() => setPresetRange({ from: subDays(today, 364), to: today })}
									>
										최근 1년
									</button>
								</div>
							</div>
						</div>

						<div className="ads-calendar">
							<div className="ads-calendar-head">
								<div style={{ fontSize: 12, fontWeight: 900 }}>기간 선택</div>
								<div style={{ fontSize: 11, color: '#9ca3af' }}>
									{draftLabel}
								</div>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
								<div data-testid="calendar-start">
									<DatePicker
										inline
										locale="ko"
										selected={draftStart}
										selectsStart
										startDate={draftStart}
										endDate={draftEnd ?? draftStart}
										openToDate={startViewMonth}
										renderCustomHeader={() => {
											return (
												<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px' }}>
													<button type="button" className="btn-ghost" onClick={() => setStartViewMonth((m) => startOfMonth(subMonths(m, 1)))}>
														‹
													</button>
													<div style={{ fontSize: 13, fontWeight: 900 }}>
														{format(startViewMonth, 'yyyy년 M월', { locale: ko })}
													</div>
													<button type="button" className="btn-ghost" onClick={() => setStartViewMonth((m) => startOfMonth(addMonths(m, 1)))}>
														›
													</button>
												</div>
											);
										}}
										onChange={(d) => {
											if (!d) return;
											const s = toLocalStartOfDay(d);
											// 시작일 선택 시 좌측 달력은 그 달로 고정
											setStartViewMonth(startOfMonth(s));
											const curEnd = draftEnd;
											if (curEnd && s.getTime() <= curEnd.getTime()) {
												setDraftStart(s);
												setDraftEnd(curEnd);
												setDraft((prev) => ({ ...prev, range: normalizeRange({ from: s, to: curEnd }) }));
												return;
											}
											// 시작일이 종료일보다 늦으면 종료일 재선택 유도(null)
											setDraftStart(s);
											setDraftEnd(null);
											setDraft((prev) => ({ ...prev, range: normalizeRange({ from: s, to: s }) }));
										}}
										maxDate={addDays(today, 1)}
									/>
								</div>

								<div data-testid="calendar-end">
									<DatePicker
										inline
										locale="ko"
										selected={draftEnd ?? draftStart}
										selectsEnd
										startDate={draftStart}
										endDate={draftEnd ?? draftStart}
										openToDate={endViewMonth}
										renderCustomHeader={() => {
											return (
												<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px' }}>
													<button type="button" className="btn-ghost" onClick={() => setEndViewMonth((m) => startOfMonth(subMonths(m, 1)))}>
														‹
													</button>
													<div style={{ fontSize: 13, fontWeight: 900 }}>
														{format(endViewMonth, 'yyyy년 M월', { locale: ko })}
													</div>
													<button type="button" className="btn-ghost" onClick={() => setEndViewMonth((m) => startOfMonth(addMonths(m, 1)))}>
														›
													</button>
												</div>
											);
										}}
										onChange={(d) => {
											if (!d) return;
											const e = toLocalStartOfDay(d);
											setEndViewMonth(startOfMonth(e));
											const s = draftStart;
											if (e.getTime() < s.getTime()) {
												// 종료일이 시작일보다 빠르면 swap
												setDraftStart(e);
												setDraftEnd(s);
												setDraft((prev) => ({ ...prev, range: normalizeRange({ from: e, to: s }) }));
												// 시작일 달력은 swap된 시작일 달로 고정
												setStartViewMonth(startOfMonth(e));
												return;
											}
											setDraftStart(s);
											setDraftEnd(e);
											setDraft((prev) => ({ ...prev, range: normalizeRange({ from: s, to: e }) }));
										}}
										maxDate={addDays(today, 1)}
									/>
								</div>
							</div>

							<div className="ads-range-actions">
								<button type="button" className="btn-ghost" onClick={cancel}>취소</button>
								<button type="button" className="btn-primary" onClick={apply}>적용</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}


