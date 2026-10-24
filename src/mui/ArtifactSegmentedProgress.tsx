import { Box } from '@mui/material';

const overviewSegmentCount = 24;
const detailSegmentCount = 12;
const segments = Array.from({ length: overviewSegmentCount }, (_, index) => ({
	id: `artifact-progress-segment-${String(index + 1)}`,
	index,
}));

export function ArtifactSegmentedProgress({
	percent,
	label,
	density,
	filledColor = '#39c5f3',
	emptyColor = 'rgba(99, 129, 145, 0.22)',
}: Readonly<{
	percent: number;
	label: string;
	density: 'overview' | 'detail';
	filledColor?: string;
	emptyColor?: string;
}>): React.ReactElement {
	const segmentCount =
		density === 'overview' ? overviewSegmentCount : detailSegmentCount;
	const filledSegments = (percent / 100) * segmentCount;
	return (
		<Box
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			sx={{
				display: 'grid',
				gridTemplateColumns: `repeat(${String(segmentCount)}, minmax(2px, 1fr))`,
				gap:
					density === 'overview'
						? { xs: '2px', sm: '3px' }
						: { xs: '1px', sm: '2px' },
				minWidth: 0,
			}}
		>
			{segments.slice(0, segmentCount).map(({ id, index }) => {
				const fill = Math.max(0, Math.min(1, filledSegments - index));
				return (
					<Box
						key={id}
						style={{
							background: `linear-gradient(90deg, ${filledColor} 0%, ${filledColor} ${String(fill * 100)}%, ${emptyColor} ${String(fill * 100)}%, ${emptyColor} 100%)`,
						}}
						sx={{
							height:
								density === 'overview' ? { xs: 10, sm: 12 } : { xs: 6, sm: 7 },
							clipPath: 'polygon(10% 0, 100% 0, 90% 100%, 0 100%)',
						}}
					/>
				);
			})}
		</Box>
	);
}
