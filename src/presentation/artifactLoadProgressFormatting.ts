export type ArtifactLoadMessages = Readonly<{
	failed: string;
	processing: string;
	assetSteps: string;
	preparationProgress: string;
	dataReceived: string;
	currentTransfer: string;
	transfer: string;
	artifacts: string;
	sources: string;
	retry: string;
	failedCount(count: string): string;
	activeStepCount(count: string): string;
	processingCount(count: string): string;
	overallProgress(title: string, activeSteps: boolean): string;
	detailProgress(assetType: string, label: string): string;
}>;

export function createArtifactLoadProgressFormatters(locale: string) {
	const counts = new Intl.NumberFormat(locale);
	const percentages = new Intl.NumberFormat(locale, {
		style: 'percent',
		maximumFractionDigits: 3,
	});
	const sizes = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const size = (bytes: number): string =>
		`${sizes.format(bytes / 1024 / 1024)}MiB`;
	return {
		count: (value: number): string => counts.format(value),
		percent: (value: number): string => percentages.format(value / 100),
		size,
		bytes: (bytes: number, totalBytes: number): string =>
			totalBytes === 0 ? size(bytes) : `${size(bytes)}/${size(totalBytes)}`,
	};
}
