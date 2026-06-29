import { describe, expect, it, vi } from 'vitest';
import {
	createRecentYmdRange,
	formatDateMonthDayLabel,
	formatDateTextOrDash,
	formatDateYmdLabel,
	formatDateTimeKo,
	formatLocalYmd,
	truncateDisplayText,
} from './dateText';

describe('dateText', () => {
	it('Date를 로컬 YMD 문자열로 변환한다', () => {
		expect(formatLocalYmd(new Date(2026, 3, 11))).toBe('2026-04-11');
	});

	it('최근 기간의 from/to YMD를 생성한다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-11T10:00:00+09:00'));
		expect(createRecentYmdRange(30)).toEqual({ fromYmd: '2026-03-13', toYmd: '2026-04-11' });
		vi.useRealTimers();
	});

	it('datetime 텍스트를 ko-KR 형식으로 표시한다', () => {
		expect(formatDateTimeKo('')).toBe('-');
		expect(formatDateTimeKo('not-a-date')).toBe('not-a-date');
		expect(formatDateTimeKo('2026-04-11T01:02:03Z')).toContain('2026');
	});

	it('날짜 라벨 포맷을 상황에 맞게 제공한다', () => {
		expect(formatDateYmdLabel('2026-04-11T12:00:00')).toBe('2026-04-11');
		expect(formatDateYmdLabel('')).toBe('-');
		expect(formatDateMonthDayLabel('2026-04-11')).toBe('04.11');
		expect(formatDateMonthDayLabel('2026-04-11T12:00:00')).toBe('04.11');
		expect(formatDateMonthDayLabel('bad-text')).toBe('bad-text');
		expect(formatDateTextOrDash('2026-04-11')).toBe('2026-04-11');
		expect(formatDateTextOrDash('')).toBe('-');
	});

	it('표시용 텍스트를 길이에 맞춰 자른다', () => {
		expect(truncateDisplayText('', 10)).toBe('-');
		expect(truncateDisplayText('짧은 문장', 10)).toBe('짧은 문장');
		expect(truncateDisplayText('abcdefghijklmnopqrstuvwxyz', 5)).toBe('abcde...');
		expect(truncateDisplayText('abcdefghijklmnopqrstuvwxyz', 5, '…')).toBe('abcde…');
	});
});
