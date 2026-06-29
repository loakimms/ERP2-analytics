import React from 'react';

import type { AiOpsDecisionCardLink } from './AiOpsDecisionCardTypes';
import { VerificationPathCard } from './AiOpsCenterLayout';

export function AiOpsVerificationSupportSection(props: {
	children?: React.ReactNode;
	sourceLink: AiOpsDecisionCardLink;
	sourceAriaLabel?: string;
	queueLink?: AiOpsDecisionCardLink | null;
	logsLink?: AiOpsDecisionCardLink | null;
	currentStep?: 'source' | 'actions' | 'logs';
}): JSX.Element {
	return (
		<>
			{props.children}
			<VerificationPathCard
				sourceLink={props.sourceLink}
				sourceAriaLabel={props.sourceAriaLabel}
				queueLink={props.queueLink}
				logsLink={props.logsLink}
				currentStep={props.currentStep}
			/>
		</>
	);
}
