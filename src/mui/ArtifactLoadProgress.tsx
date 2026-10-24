import {
	Box,
	Button,
	CircularProgress,
	Paper,
	Stack,
	Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { ArtifactLoadSummary } from '../domain/artifactLoadSummary.ts';
import { formatArtifactLoadLabel } from '../presentation/artifactLoadLabels.ts';
import { ArtifactSegmentedProgress } from './ArtifactSegmentedProgress.tsx';

export function ArtifactLoadProgress({
	title,
	completionLabel,
	summary,
	idleLabel = '準備開始を待っています。',
	activeSteps = [],
	onRetry,
	actions,
	renderError,
	formatStageLabel = formatArtifactLoadLabel,
	progressColors,
	sx,
}: Readonly<{
	title: string;
	completionLabel: string;
	summary: ArtifactLoadSummary;
	idleLabel?: string;
	activeSteps?: readonly string[];
	onRetry?: () => void;
	actions?: ReactNode;
	renderError?: (message: string) => ReactNode;
	formatStageLabel?: (label: string) => string;
	progressColors?: Readonly<{ filledColor?: string; emptyColor?: string }>;
	sx?: import('@mui/material').SxProps<import('@mui/material').Theme>;
}>): React.ReactElement {
	const message =
		summary.failed > 0
			? `準備に失敗しました：${String(summary.failed)}件`
			: activeSteps.length > 0
				? `${String(activeSteps.length)}工程を処理しています。`
				: summary.completed
					? completionLabel
					: summary.total === 0
						? idleLabel
						: `${String(summary.processing)}件を処理しています。`;
	return (
		<Paper
			variant="outlined"
			sx={[
				{
					height: { xs: 340, sm: 284 },
					minWidth: 0,
					overflow: 'hidden',
					p: { xs: 1, sm: 1.25 },
				},
				...(Array.isArray(sx) ? sx : sx === undefined ? [] : [sx]),
			]}
			data-artifact-load-title={title}
			data-artifact-load-completed={String(summary.completed)}
			data-artifact-load-processing={String(summary.processing)}
			data-artifact-load-failed={String(summary.failed)}
			data-artifact-load-progress-percent={String(summary.progressPercent)}
			data-artifact-load-active-step-count={String(activeSteps.length)}
		>
			<Stack spacing={0.75} sx={{ height: '100%' }}>
				<Stack
					direction="row"
					sx={{ alignItems: 'center', justifyContent: 'space-between' }}
				>
					<Typography variant="subtitle2">{title}</Typography>
					<Stack direction="row" sx={{ alignItems: 'center' }}>
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ fontVariantNumeric: 'tabular-nums' }}
						>
							{summary.failed > 0
								? '失敗'
								: activeSteps.length > 0
									? '処理中'
									: `${String(summary.progressPercent)}%`}
						</Typography>
						{actions}
					</Stack>
				</Stack>
				<ArtifactSegmentedProgress
					{...progressColors}
					percent={summary.progressPercent}
					label={`${title}の${activeSteps.length > 0 ? 'asset工程' : '全体'}進捗`}
					density="overview"
				/>
				<Stack
					direction="row"
					useFlexGap
					sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5 }}
				>
					<Typography
						variant="caption"
						sx={{ fontVariantNumeric: 'tabular-nums' }}
					>
						{activeSteps.length > 0 ? 'asset工程' : '準備進捗'}{' '}
						{summary.progressPercent}%
					</Typography>
					<Typography
						variant="caption"
						sx={{ fontVariantNumeric: 'tabular-nums' }}
					>
						データ受信{' '}
						{formatByteProgress(
							Math.max(summary.preparedBytes, summary.networkReceivedBytes),
							summary.totalBytes,
						)}
					</Typography>
					<Typography
						variant="caption"
						color="text.secondary"
						sx={{ fontVariantNumeric: 'tabular-nums' }}
					>
						今回の通信 {formatMiB(summary.networkReceivedBytes)}
					</Typography>
					<Typography
						variant="caption"
						color="text.secondary"
						sx={{ fontVariantNumeric: 'tabular-nums' }}
					>
						成果物 {summary.succeeded}/{summary.total}件
					</Typography>
					{summary.totalArtifacts > 0 ? (
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ fontVariantNumeric: 'tabular-nums' }}
						>
							source {summary.completedArtifacts}/{summary.totalArtifacts}
						</Typography>
					) : null}
				</Stack>
				<Stack
					direction="row"
					sx={{ alignItems: 'center', justifyContent: 'space-between' }}
				>
					<Typography variant="caption">{message}</Typography>
					{summary.failed > 0 && onRetry !== undefined ? (
						<Button size="small" onClick={onRetry}>
							再試行
						</Button>
					) : null}
				</Stack>
				<Box
					sx={{
						flex: 1,
						minHeight: 0,
						overflowY: 'auto',
						borderTop: '1px solid',
						borderColor: 'divider',
						pt: 0.5,
					}}
				>
					{summary.failed === 0 && activeSteps.length > 0 ? (
						<Stack spacing={0.75} sx={{ mb: 0.75 }}>
							{activeSteps.map((step) => (
								<Stack
									key={step}
									direction="row"
									spacing={1}
									sx={{ alignItems: 'center', minWidth: 0 }}
								>
									<CircularProgress size={16} sx={{ flexShrink: 0 }} />
									<Typography variant="caption">{step}</Typography>
								</Stack>
							))}
						</Stack>
					) : null}
					{summary.details.length === 0 ? (
						<Typography variant="caption" color="text.secondary">
							{idleLabel}
						</Typography>
					) : (
						<Stack spacing={0.75}>
							{summary.details.map((detail) => (
								<Box
									key={detail.identity}
									sx={{
										borderBottom: '1px solid',
										borderColor: 'divider',
										pb: 0.75,
									}}
								>
									<Stack
										direction={{ xs: 'column', sm: 'row' }}
										sx={{
											justifyContent: 'space-between',
											columnGap: 1,
										}}
									>
										<Typography
											variant="caption"
											noWrap
											title={`${detail.assetType}／${detail.label}`}
											sx={{ fontWeight: 600 }}
										>
											{detail.assetType}／{detail.label}
										</Typography>
										<ArtifactStatusText
											message={
												detail.error ??
												detailProgressLabel(detail, formatStageLabel)
											}
											renderError={renderError}
											status={detail.status}
											error={detail.error !== null}
										/>
									</Stack>
									<ArtifactSegmentedProgress
										{...progressColors}
										percent={detail.progressPercent}
										label={`${detail.assetType} ${detail.label}の進捗`}
										density="detail"
									/>
									<Stack
										direction="row"
										useFlexGap
										sx={{ flexWrap: 'wrap', columnGap: 1 }}
									>
										<Typography variant="caption" color="text.secondary">
											データ受信{' '}
											{formatByteProgress(
												Math.max(
													detail.transferredBytes,
													detail.networkReceivedBytes,
												),
												detail.totalBytes,
											)}
										</Typography>
										<Typography variant="caption" color="text.secondary">
											通信 {formatMiB(detail.networkReceivedBytes)}
										</Typography>
										{detail.totalArtifacts > 0 ? (
											<Typography variant="caption" color="text.secondary">
												source {detail.completedArtifacts}/
												{detail.totalArtifacts}
											</Typography>
										) : null}
									</Stack>
									{detail.phases.length > 0 ? (
										<Stack
											direction="row"
											useFlexGap
											sx={{ flexWrap: 'wrap', gap: 0.375, mt: 0.375 }}
										>
											{detail.phases.map((phase) => (
												<Box
													key={phase.label}
													sx={{
														border: '1px solid',
														borderColor: phaseStatusBorder(phase.status),
														borderRadius: 1,
														bgcolor: 'transparent',
														color: phaseStatusColor(phase.status),
														px: 0.5,
														py: 0.125,
													}}
												>
													<Typography variant="caption" component="span">
														{formatStageLabel(phase.label)}{' '}
														{phase.error ?? formatStageLabel(phase.stage)}
													</Typography>
												</Box>
											))}
										</Stack>
									) : null}
								</Box>
							))}
						</Stack>
					)}
				</Box>
			</Stack>
		</Paper>
	);
}

function ArtifactStatusText({
	message,
	status,
	error,
	renderError,
}: Readonly<{
	message: string;
	status: ArtifactLoadSummary['details'][number]['status'];
	error: boolean;
	renderError: ((message: string) => ReactNode) | undefined;
}>): React.ReactElement {
	if (error && renderError !== undefined) return <>{renderError(message)}</>;
	return (
		<Stack
			direction="row"
			sx={{ alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}
		>
			<Typography
				variant="caption"
				noWrap
				title={message}
				color={detailStatusColor(status)}
				sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
			>
				{message}
			</Typography>
		</Stack>
	);
}

function detailStatusColor(
	status: ArtifactLoadSummary['details'][number]['status'],
): 'error.main' | 'success.main' | 'text.secondary' {
	return status === 'failed'
		? 'error.main'
		: status === 'complete'
			? 'success.main'
			: 'text.secondary';
}

function phaseStatusBorder(
	status: ArtifactLoadSummary['details'][number]['status'],
): 'error.main' | 'success.main' | 'divider' {
	return status === 'failed'
		? 'error.main'
		: status === 'complete'
			? 'success.main'
			: 'divider';
}

function phaseStatusColor(
	status: ArtifactLoadSummary['details'][number]['status'],
): 'error.main' | 'primary.main' | 'text.secondary' {
	return status === 'failed'
		? 'error.main'
		: status === 'processing'
			? 'primary.main'
			: 'text.secondary';
}

function detailProgressLabel(
	detail: ArtifactLoadSummary['details'][number],
	formatStageLabel: (label: string) => string,
): string {
	const artifactProgress =
		detail.totalArtifacts > 1
			? `${String(detail.completedArtifacts)}/${String(detail.totalArtifacts)}source`
			: null;
	const byteProgress =
		detail.totalBytes === 0
			? null
			: formatByteProgress(
					Math.max(detail.transferredBytes, detail.networkReceivedBytes),
					detail.totalBytes,
				);
	return [
		detail.activeArtifactLabel,
		formatStageLabel(detail.stage),
		artifactProgress,
		byteProgress,
	]
		.filter((value) => value !== null)
		.join(' ');
}

function formatByteProgress(bytes: number, totalBytes: number): string {
	return totalBytes === 0
		? formatMiB(bytes)
		: `${formatMiB(bytes)}/${formatMiB(totalBytes)}`;
}

function formatMiB(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}
