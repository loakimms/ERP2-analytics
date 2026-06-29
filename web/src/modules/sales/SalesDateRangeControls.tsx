import React, { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
	addDays,
	addMonths,
	endOfMonth,
	endOfWeek,
	format,
	parseISO,
	startOfMonth,
	startOfWeek,
	subDays,
	subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale/ko';

registerLocale('ko', ko);

type Props = {
	fromYmd: string;
	toYmd: string;
	onChange: (next: { fromYmd: string; toYmd: string }) => void;
	disabled?: boolean;
	compact?: boolean;
	title?: string;
	ariaLabel?: string;
};

function parseYmd(s: string): Date {
	const dt = parseISO(String(s || '').trim());
	return Number.isFinite(dt.getTime()) ? dt : new Date();
}

function toLocalStartOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toYmd(d: Date): string {
	return format(d, 'yyyy-MM-dd');
}

function normalizeRange(range: { from: Date; to: Date }) {
	const from = toLocalStartOfDay(range.from);
	const to = toLocalStartOfDay(range.to);
	return from.getTime() <= to.getTime() ? { from, to } : { from: to, to: from };
}

function formatDotDate(d: Date): string {
	return format(toLocalStartOfDay(d), 'yyyy.MM.dd.');
}

function formatRangeLabel(range: { from: Date; to: Date }): string {
	const r = normalizeRange(range);
	return `${formatDotDate(r.from)} ~ ${formatDotDate(r.to)}`;
}

function rangeLengthDays(range: { from: Date; to: Date }): number {
	const r = normalizeRange(range);
	return Math.max(1, Math.floor((r.to.getTime() - r.from.getTime()) / 86400000) + 1);
}

export function SalesDateRangeControls(props: Props): JSX.Element {
	const title = String(props.title || '조회 기간').trim() || '조회 기간';
	const rangeAriaLabel = String(props.ariaLabel || 'sales-date-range').trim() || 'sales-date-range';
	const [open, setOpen] = useState(false);
	const today = useMemo(() => toLocalStartOfDay(new Date()), []);
	const currentRange = useMemo(
		() =>
			normalizeRange({
				from: parseYmd(props.fromYmd),
				to: parseYmd(props.toYmd),
			}),
		[props.fromYmd, props.toYmd],
	);
	const [draftStart, setDraftStart] = useState<Date>(currentRange.from);
	const [draftEnd, setDraftEnd] = useState<Date | null>(currentRange.to);
	const [startViewMonth, setStartViewMonth] = useState<Date>(() => startOfMonth(currentRange.from));
	const [endViewMonth, setEndViewMonth] = useState<Date>(() => startOfMonth(currentRange.to));
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (open) return;
		setDraftStart(currentRange.from);
		setDraftEnd(currentRange.to);
	}, [currentRange.from, currentRange.to, open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (ev: MouseEvent) => {
			const root = rootRef.current;
			const target = ev.target as Node | null;
			if (!root || !target || root.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener('mousedown', onPointerDown);
		return () => document.removeEventListener('mousedown', onPointerDown);
	}, [open]);

	const draftLabel = useMemo(() => {
		const s = toYmd(draftStart);
		const e = toYmd(draftEnd ?? draftStart);
		return `${s} ~ ${e}`;
	}, [draftStart, draftEnd]);

	const syncDraftFromCurrent = () => {
		setDraftStart(currentRange.from);
		setDraftEnd(currentRange.to);
		const endM = startOfMonth(currentRange.to);
		const startM = startOfMonth(currentRange.from);
		setEndViewMonth(endM);
		setStartViewMonth(startM.getTime() === endM.getTime() ? startOfMonth(subMonths(endM, 1)) : startM);
	};

	const toggleOpen = () => {
		if (props.disabled) return;
		setOpen((prev) => {
			const next = !prev;
			if (!prev) syncDraftFromCurrent();
			return next;
		});
	};

	const apply = () => {
		const next = normalizeRange({ from: draftStart, to: draftEnd ?? draftStart });
		props.onChange({ fromYmd: toYmd(next.from), toYmd: toYmd(next.to) });
		setOpen(false);
	};

	const cancel = () => {
		syncDraftFromCurrent();
		setOpen(false);
	};

	const setPresetRange = (range: { from: Date; to: Date }) => {
		const next = normalizeRange(range);
		setDraftStart(next.from);
		setDraftEnd(next.to);
		const endM = startOfMonth(next.to);
		const startM = startOfMonth(next.from);
		setEndViewMonth(endM);
		setStartViewMonth(startM.getTime() === endM.getTime() ? startOfMonth(subMonths(endM, 1)) : startM);
	};

	const shiftByPeriod = (dir: -1 | 1) => {
		const len = rangeLengthDays(currentRange);
		const next = normalizeRange({
			from: addDays(currentRange.from, dir * len),
			to: addDays(currentRange.to, dir * len),
		});
		props.onChange({ fromYmd: toYmd(next.from), toYmd: toYmd(next.to) });
	};

	return (
		<div className={`ads-controls${props.compact ? ' sales-date-controls' : ''}`} ref={rootRef} data-testid="sales-date-range-root">
			<div className="ads-controls-left">
				<div className="ads-controls-title">{title}</div>
				<div className="ads-controls-sub">{formatRangeLabel(currentRange)}</div>
			</div>

			<div className="ads-controls-right">
				<button type="button" className="btn-ghost ads-nav-btn" onClick={() => shiftByPeriod(-1)} title="이전 기간" disabled={props.disabled}>
					‹
				</button>
				<button type="button" className="ads-range-btn" onClick={toggleOpen} aria-label={rangeAriaLabel} disabled={props.disabled}>
					{formatRangeLabel(currentRange)}
				</button>
				<button type="button" className="btn-ghost ads-nav-btn" onClick={() => shiftByPeriod(1)} title="다음 기간" disabled={props.disabled}>
					›
				</button>
			</div>

			{open ? (
				<div className={`ads-range-popover${props.compact ? ' sales-range-popover' : ''}`} role="dialog" aria-label={`${title} 선택`}>
					<div className={`ads-range-popover-body${props.compact ? ' sales-range-popover-body' : ''}`} data-testid="sales-date-range-popover-body">
						<div className={`ads-presets${props.compact ? ' sales-range-presets' : ''}`}>
							<div className="ads-presets-col">
								<div className="ads-presets-title">빠른 선택</div>
								<div className="ads-presets-grid">
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: today, to: today })}>오늘</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 1), to: subDays(today, 1) })}>어제</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfWeek(today, { weekStartsOn: 1 }), to: today })}>이번 주</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfWeek(subDays(today, 7), { weekStartsOn: 1 }), to: endOfWeek(subDays(today, 7), { weekStartsOn: 1 }) })}>지난 주</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: startOfMonth(today), to: today })}>이번 달</button>
									<button
										type="button"
										className="ads-preset"
										onClick={() => {
											const prevMonth = subMonths(today, 1);
											setPresetRange({ from: startOfMonth(prevMonth), to: endOfMonth(prevMonth) });
										}}
									>
										지난 달
									</button>
								</div>
							</div>
							<div className="ads-presets-col">
								<div className="ads-presets-title">최근</div>
								<div className="ads-presets-grid">
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 6), to: today })}>최근 7일(오늘 포함)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 7), to: subDays(today, 1) })}>최근 7일(오늘 제외)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 29), to: today })}>최근 30일(오늘 포함)</button>
									<button type="button" className="ads-preset" onClick={() => setPresetRange({ from: subDays(today, 30), to: subDays(today, 1) })}>최근 30일(오늘 제외)</button>
								</div>
							</div>
						</div>

						<div className="ads-calendar">
							<div className="ads-calendar-head">
								<div style={{ fontSize: 12, fontWeight: 900 }}>기간 선택</div>
								<div style={{ fontSize: 11, color: '#9ca3af' }}>{draftLabel}</div>
							</div>

							<div className={props.compact ? 'sales-range-calendars' : ''} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
								<div data-testid="sales-calendar-start">
									<DatePicker
										inline
										locale="ko"
										selected={draftStart}
										selectsStart
										startDate={draftStart}
										endDate={draftEnd ?? draftStart}
										openToDate={startViewMonth}
										renderCustomHeader={() => (
											<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px' }}>
												<button type="button" className="btn-ghost" onClick={() => setStartViewMonth((m) => startOfMonth(subMonths(m, 1)))}>‹</button>
												<div style={{ fontSize: 13, fontWeight: 900 }}>{format(startViewMonth, 'yyyy년 M월', { locale: ko })}</div>
												<button type="button" className="btn-ghost" onClick={() => setStartViewMonth((m) => startOfMonth(addMonths(m, 1)))}>›</button>
											</div>
										)}
										onChange={(d) => {
											if (!d) return;
											const start = toLocalStartOfDay(d);
											setStartViewMonth(startOfMonth(start));
											if (draftEnd && start.getTime() <= draftEnd.getTime()) {
												setDraftStart(start);
												return;
											}
											setDraftStart(start);
											setDraftEnd(null);
										}}
										maxDate={today}
									/>
								</div>
								<div data-testid="sales-calendar-end">
									<DatePicker
										inline
										locale="ko"
										selected={draftEnd ?? draftStart}
										selectsEnd
										startDate={draftStart}
										endDate={draftEnd ?? draftStart}
										openToDate={endViewMonth}
										renderCustomHeader={() => (
											<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px' }}>
												<button type="button" className="btn-ghost" onClick={() => setEndViewMonth((m) => startOfMonth(subMonths(m, 1)))}>‹</button>
												<div style={{ fontSize: 13, fontWeight: 900 }}>{format(endViewMonth, 'yyyy년 M월', { locale: ko })}</div>
												<button type="button" className="btn-ghost" onClick={() => setEndViewMonth((m) => startOfMonth(addMonths(m, 1)))}>›</button>
											</div>
										)}
										onChange={(d) => {
											if (!d) return;
											const end = toLocalStartOfDay(d);
											setEndViewMonth(startOfMonth(end));
											if (end.getTime() < draftStart.getTime()) {
												setDraftStart(end);
												setDraftEnd(draftStart);
												setStartViewMonth(startOfMonth(end));
												return;
											}
											setDraftEnd(end);
										}}
										maxDate={today}
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
			) : null}
		</div>
	);
}
