export function buildHostSetupDownloadName(target: 'local' | 'nas', originalName: string): string {
	const mode = target === 'nas' ? 'NAS' : 'LOCAL';
	const raw = String(originalName || '').trim();
	if (!raw) return `analytics-host-setup-${mode}.ps1`;
	const dot = raw.lastIndexOf('.');
	if (dot <= 0 || dot === raw.length - 1) return `${raw}-${mode}`;
	const base = raw.slice(0, dot);
	const ext = raw.slice(dot);
	return `${base}-${mode}${ext}`;
}
