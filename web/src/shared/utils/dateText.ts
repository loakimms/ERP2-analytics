export function formatLocalYmd(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, '0');
	const day = String(value.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function createRecentYmdRange(daysInclusive: number): { fromYmd: string; toYmd: string } {
	const today = new Date();
	const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - Math.max(0, daysInclusive - 1));
	return { fromYmd: formatLocalYmd(start), toYmd: formatLocalYmd(end) };
}

export function formatDateTimeKo(value?: string | null): string {
	const text = String(value || '').trim();
	if (!text) return '-';
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return text;
	return parsed.toLocaleString('ko-KR');
}

export function formatDateYmdLabel(value?: string | null): string {
	const text = String(value || '').trim();
	return text ? text.slice(0, 10) : '-';
}

export function formatDateMonthDayLabel(value?: string | null): string {
	const text = String(value || '').trim();
	if (!text) return '-';
	const parsed = new Date(text);
	if (!Number.isNaN(parsed.getTime())) {
		return `${String(parsed.getMonth() + 1).padStart(2, '0')}.${String(parsed.getDate()).padStart(2, '0')}`;
	}
	const [year, month, day] = text.split('-');
	if (year && month && day) return `${month}.${day}`;
	return text;
}

export function formatDateTextOrDash(value?: string | null): string {
	const text = String(value || '').trim();
	return text || '-';
}

export function truncateDisplayText(value: string | null | undefined, maxLength = 120, suffix = '...'): string {
	const text = String(value || '').trim();
	if (!text) return '-';
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}${suffix}`;
}
