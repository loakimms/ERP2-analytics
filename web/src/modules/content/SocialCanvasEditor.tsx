import { OverlayCanvasEditor, type OverlayCanvasEditorProps } from '../shared/editor/OverlayCanvasEditor';

export {
	clamp,
	defaultLayerLabels,
	defaultOverlayLayout,
	LayerPropertyPanel,
	OverlayCanvas,
	overlayFromValue,
	type OverlayItem,
	type OverlayKey,
	type OverlayLayout,
} from '../shared/editor/OverlayCanvasEditor';

export function SocialCanvasEditor(props: OverlayCanvasEditorProps): JSX.Element {
	return <OverlayCanvasEditor {...props} />;
}
