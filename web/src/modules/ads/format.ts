const nfInt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nfFloat2 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfFloatUpTo2 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nfPctInt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

export function formatInt(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return nfInt.format(v);
}

export function formatWon(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return `${nfInt.format(v)}원`;
}

export function formatPct(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return `${nfFloat2.format(v)}%`;
}

export function formatPctInt(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return `${nfPctInt.format(v)}%`;
}

export function formatFloat2(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return nfFloat2.format(v);
}

export function formatFloatUpTo2(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v)) return '-';
	return nfFloatUpTo2.format(v);
}

export function formatSignedInt(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v) || v === 0) return '0';
	const sign = v > 0 ? '+' : '';
	return `${sign}${formatInt(v)}`;
}

export function formatSignedPct(v: number | null | undefined): string {
	if (v == null || !Number.isFinite(v) || v === 0) return '0%';
	const sign = v > 0 ? '+' : '';
	return `${sign}${nfFloat2.format(v)}%`;
}


