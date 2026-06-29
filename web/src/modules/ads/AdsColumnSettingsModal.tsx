import React, { useMemo } from 'react';

export type AdsColumnSettingOption = {
	key: string;
	label: string;
	group: string;
};

export function AdsColumnSettingsModal(props: {
	open: boolean;
	title: string;
	options: AdsColumnSettingOption[];
	selectedKeys: string[];
	onChange: (nextSelectedKeys: string[]) => void;
	onClose: () => void;
	onReset: () => void;
}): JSX.Element | null {
	const selectedSet = useMemo(() => new Set(props.selectedKeys), [props.selectedKeys]);
	const groups = useMemo(() => {
		const map = new Map<string, AdsColumnSettingOption[]>();
		for (const option of props.options) {
			const arr = map.get(option.group) ?? [];
			arr.push(option);
			map.set(option.group, arr);
		}
		return [...map.entries()];
	}, [props.options]);

	if (!props.open) return null;

	const toggleKey = (key: string) => {
		const next = new Set(props.selectedKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		props.onChange(props.options.filter((option) => next.has(option.key)).map((option) => option.key));
	};

	const selectedOptions = props.options.filter((option) => selectedSet.has(option.key));

	return (
		<div className="modal-backdrop" role="dialog" aria-label={`${props.title} 헤더 설정`}>
			<div className="modal-card" style={{ maxWidth: 920 }}>
				<div className="modal-header">
					<div className="modal-title">{props.title} 헤더 설정</div>
					<button type="button" className="btn-ghost" onClick={props.onClose}>
						닫기
					</button>
				</div>
				<div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
					<div style={{ display: 'grid', gap: 12 }}>
						<div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
							표 헤더를 개별로 숨기거나 다시 표시할 수 있습니다. 순서는 기본 순서를 유지합니다.
						</div>
						{groups.map(([groupName, options]) => (
							<div key={groupName} className="card" style={{ padding: 12 }}>
								<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb', marginBottom: 8 }}>{groupName}</div>
								<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
									{options.map((option) => (
										<label key={option.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#e5e7eb', cursor: 'pointer' }}>
											<input
												type="checkbox"
												aria-label={option.label}
												checked={selectedSet.has(option.key)}
												onChange={() => toggleKey(option.key)}
											/>
											<span>{option.label}</span>
										</label>
									))}
								</div>
							</div>
						))}
					</div>
					<div className="card" style={{ padding: 12 }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
							<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>
								선택된 헤더
							</div>
							<div style={{ fontSize: 12, color: '#9ca3af' }}>
								{selectedOptions.length}개
							</div>
						</div>
						<div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
							{selectedOptions.length === 0 ? (
								<div style={{ fontSize: 12, color: '#9ca3af' }}>선택된 헤더가 없습니다.</div>
							) : (
								selectedOptions.map((option) => (
									<div
										key={option.key}
										style={{
											border: '1px solid rgba(148,163,184,0.18)',
											borderRadius: 10,
											padding: '8px 10px',
											fontSize: 12,
											color: '#e5e7eb',
											background: 'rgba(2,6,23,0.25)',
										}}
									>
										{option.label}
									</div>
								))
							)}
						</div>
					</div>
				</div>
				<div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
					<button type="button" className="btn-ghost" onClick={props.onReset}>
						기본값 복원
					</button>
					<button type="button" className="btn-primary" onClick={props.onClose}>
						닫기
					</button>
				</div>
			</div>
		</div>
	);
}
