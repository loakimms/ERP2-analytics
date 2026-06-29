import React from 'react';

import type { AiOpsDecisionCardLink } from './AiOpsDecisionCardTypes';
import { AiOpsMetricTile, AiOpsVerificationSupportSection } from './AiOpsPresentationShared';

export function AiOpsProductDecisionExtraContent(props: {
	priorityLabel: string;
	confidenceLabel: string;
	dataQualityLabel: string;
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
			>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
					<AiOpsMetricTile label="우선순위" value={props.priorityLabel} />
					<AiOpsMetricTile label="신뢰도" value={props.confidenceLabel} />
					<AiOpsMetricTile label="데이터 품질" value={props.dataQualityLabel} />
				</div>
			</AiOpsVerificationSupportSection>
		</>
	);
}
