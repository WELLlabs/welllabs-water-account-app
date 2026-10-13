export function fmt(n: number): string {
	return Math.round(n).toLocaleString('en-IN');
}

export function fmtAcres(n: number): string {
	return n < 100 ? n.toFixed(1) : fmt(n);
}

export function fmtDuration(sec: number): string {
	if (sec < 60) return `about ${Math.max(1, Math.round(sec))} s`;
	return `about ${Math.round(sec / 60)} min`;
}
