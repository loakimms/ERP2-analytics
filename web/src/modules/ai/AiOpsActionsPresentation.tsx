import React from 'react';

import type { AiOpsDecisionCardLink } from './AiOpsDecisionCardTypes';
import { AiOpsVerificationSupportSection } from './AiOpsPresentationShared';

export function AiOpsActionReviewSection(props: {
	children?: React.ReactNode;
	noteValue: string;
	onNoteChange: (nextValue: string) => void;
	existingNote?: string | null;
	sourceLink: AiOpsDecisionCardLink;
	sourceAriaLabel?: string;
	queueLink: AiOpsDecisionCardLink;
	logsLink: AiOpsDecisionCardLink;
}): JSX.Element {
	return (
		<>
				<AiOpsVerificationSupportSection
				sourceLink={props.sourceLink}
				sourceAriaLabel={props.sourceAriaLabel}
				queueLink={props.queueLink}
				logsLink={props.logsLink}
				currentStep="actions"
				>
					{props.children}
					<div style={{ marginTop: 10 }}>
						<input
							type="text"
							value={props.noteValue}
							onChange={(event) => props.onNoteChange(event.target.value)}
							placeholder="검토 메모를 입력하세요"
							style={{
								width: '100%',
								borderRadius: 8,
								border: '1px solid rgba(148,163,184,0.22)',
								background: 'rgba(2,6,23,0.5)',
								color: '#e2e8f0',
								padding: '10px 12px',
							}}
						/>
					</div>
					{props.existingNote ? (
						<div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>기존 메모: {props.existingNote}</div>
					) : null}
				</AiOpsVerificationSupportSection>
		</>
	);
}

export function AiOpsActionStatusActions(props: {
	approveLabel: string;
	onApprove: () => void;
	onReject: () => void;
	onDone: () => void;
	disabled?: boolean;
}): JSX.Element {
	return (
		<>
			<button type="button" className="btn-ghost" onClick={props.onApprove} disabled={props.disabled}>
				{props.approveLabel}
			</button>
			<button type="button" className="btn-ghost" onClick={props.onReject} disabled={props.disabled}>
				반려
			</button>
			<button type="button" className="btn-ghost" onClick={props.onDone} disabled={props.disabled}>
				완료
			</button>
		</>
	);
}
