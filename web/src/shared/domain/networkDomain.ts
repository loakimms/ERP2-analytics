export function isTransientPollingError(error: any): boolean {
	const code = String(error?.code || '').trim().toUpperCase();
	if (code === 'ECONNABORTED' || code === 'ERR_NETWORK') return true;
	const status = Number(error?.response?.status || 0);
	if (status >= 500 && status < 600) return true;
	const message = String(error?.message || '').toLowerCase();
	return message.includes('timeout') || message.includes('network');
}
